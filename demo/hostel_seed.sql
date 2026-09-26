-- DryRun demo: a hostel management database with the realistic "hidden problems" that make migrations fail.
-- Deterministic (setseed) so every run produces the same data.
--   * 3 rooms hold more students than their capacity          → CHECK (occupied <= capacity) fails
--   * 6 sibling pairs (12 students) share a parent's phone    → UNIQUE (phone) fails
--   * 8 new students have no room yet (room_id IS NULL)       → SET NOT NULL fails
--   * fees with paise (₹4,500.50)                             → converting to integer silently rounds money
-- Usage: createdb hostel && psql -d hostel -f demo/hostel_seed.sql

BEGIN;
SELECT setseed(0.42);
SET client_min_messages = warning;

CREATE TABLE blocks (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  warden text NOT NULL
);

CREATE TABLE rooms (
  id serial PRIMARY KEY,
  block_id int NOT NULL REFERENCES blocks(id),
  room_no text NOT NULL UNIQUE,
  floor int NOT NULL,
  capacity int NOT NULL,
  occupied int NOT NULL DEFAULT 0
);

CREATE TABLE students (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  course text NOT NULL,
  year int NOT NULL,
  joined_on date NOT NULL
);

CREATE TABLE allocations (
  id serial PRIMARY KEY,
  student_id int NOT NULL UNIQUE REFERENCES students(id),
  room_id int REFERENCES rooms(id),
  allocated_on date
);

CREATE TABLE fees (
  id serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id),
  term text NOT NULL,
  amount numeric(10,2) NOT NULL,
  due_date date NOT NULL,
  paid boolean NOT NULL DEFAULT false
);

CREATE TABLE complaints (
  id serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id),
  room_id int REFERENCES rooms(id),
  category text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE maintenance (
  id serial PRIMARY KEY,
  complaint_id int NOT NULL REFERENCES complaints(id),
  technician text NOT NULL,
  cost numeric(10,2) NOT NULL,
  done_on date
);

INSERT INTO blocks (name, warden) VALUES
  ('A · Ganga', 'Mrs. Lakshmi Rao'), ('B · Yamuna', 'Mr. Joseph Mathew'), ('C · Kaveri', 'Mrs. Farah Khan'), ('D · Narmada', 'Mr. Vivek Menon');

-- 300 rooms, 75 per block, capacities 2–4
INSERT INTO rooms (block_id, room_no, floor, capacity)
SELECT b, chr(64 + b) || '-' || (100 * (1 + (n - 1) / 25) + ((n - 1) % 25) + 1), 1 + (n - 1) / 25, 2 + floor(random() * 3)::int
FROM generate_series(1, 4) b, generate_series(1, 75) n;

-- 850 students with Indian names
WITH first AS (SELECT unnest(ARRAY['Aarav','Vivaan','Aditya','Arjun','Sai','Rohan','Kabir','Ishaan','Ananya','Diya','Priya','Meera','Riya','Sneha','Kavya','Nisha','Rahul','Amit','Karthik','Vikram','Pooja','Divya','Lakshmi','Farhan','Joseph','Neha','Tanvi','Harsh','Manoj','Deepika']) f),
     last AS (SELECT unnest(ARRAY['Sharma','Nair','Iyer','Reddy','Menon','Patel','Gupta','Rao','Khan','Das','Singh','Pillai','Joshi','Kumar','Thomas','Varghese','Bose','Mehta','Shetty','Naidu']) l),
     names AS (SELECT f, l, row_number() OVER (ORDER BY random()) rn FROM first, last, generate_series(1, 2))
INSERT INTO students (name, email, phone, course, year, joined_on)
SELECT f || ' ' || l,
       lower(f) || '.' || lower(l) || rn || '@college.edu',
       '9' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'),
       (ARRAY['B.Tech CSE','B.Tech ECE','B.Tech ME','BBA','B.Com','B.Sc Physics','MBA','M.Tech CSE'])[1 + floor(random() * 8)::int],
       1 + floor(random() * 4)::int,
       date '2023-06-01' + (floor(random() * 800))::int
FROM names WHERE rn <= 850;

-- 6 sibling pairs registered with the same parent phone
UPDATE students s SET phone = p.phone
FROM (SELECT id, phone FROM students WHERE id IN (11, 57, 203, 390, 512, 777)) p
WHERE s.id = p.id + 1;

-- Allocate students room by room up to capacity; the last 8 students have no room yet
WITH slots AS (
  SELECT r.id AS room_id, row_number() OVER (ORDER BY r.id, g) AS slot
  FROM rooms r, generate_series(1, 4) g WHERE g <= r.capacity
), studs AS (
  SELECT id, row_number() OVER (ORDER BY id) AS slot FROM students WHERE id <= 842
)
INSERT INTO allocations (student_id, room_id, allocated_on)
SELECT st.id, sl.room_id, date '2024-06-15' + (st.id % 60) FROM studs st JOIN slots sl USING (slot);

INSERT INTO allocations (student_id, room_id, allocated_on)
SELECT id, NULL, NULL FROM students WHERE id > 842;

-- 3 rooms overbooked by one student each (moved in during the mid-term rush)
UPDATE allocations SET room_id = (SELECT id FROM rooms WHERE room_no = 'A-101') WHERE student_id = (SELECT min(student_id) FROM allocations a JOIN rooms r ON r.id = a.room_id WHERE r.room_no = 'A-102');
UPDATE allocations SET room_id = (SELECT id FROM rooms WHERE room_no = 'B-204') WHERE student_id = (SELECT min(student_id) FROM allocations a JOIN rooms r ON r.id = a.room_id WHERE r.room_no = 'B-205');
UPDATE allocations SET room_id = (SELECT id FROM rooms WHERE room_no = 'C-310') WHERE student_id = (SELECT min(student_id) FROM allocations a JOIN rooms r ON r.id = a.room_id WHERE r.room_no = 'C-311');

UPDATE rooms r SET occupied = (SELECT count(*) FROM allocations a WHERE a.room_id = r.id);

-- Fees: two terms per student; hostel + mess charges, ~5% with paise from partial refunds
INSERT INTO fees (student_id, term, amount, due_date, paid)
SELECT s.id, t.term,
       CASE WHEN random() < 0.055 THEN 42500 + floor(random() * 4000) + (ARRAY[0.25, 0.50, 0.75])[1 + floor(random() * 3)::int]
            ELSE 42500 + 500 * floor(random() * 8) END,
       t.due, random() < 0.8
FROM students s, (VALUES ('2026-odd', date '2026-07-15'), ('2026-even', date '2027-01-15')) AS t(term, due);

-- Complaints and the maintenance work linked to them
INSERT INTO complaints (student_id, room_id, category, description, status, created_at)
SELECT a.student_id, a.room_id,
       (ARRAY['plumbing','electrical','wifi','furniture','cleaning','mess'])[1 + floor(random() * 6)::int],
       (ARRAY['Tap leaking in bathroom','Fan not working','Wi-Fi drops every evening','Broken chair','Room not cleaned','Food quality issue'])[1 + floor(random() * 6)::int],
       (ARRAY['open','in_progress','resolved','resolved'])[1 + floor(random() * 4)::int],
       timestamptz '2025-01-01' + (random() * interval '600 days')
FROM allocations a WHERE a.room_id IS NOT NULL AND random() < 0.72;

INSERT INTO maintenance (complaint_id, technician, cost, done_on)
SELECT c.id, (ARRAY['Ravi (plumber)','Suresh (electrician)','NetCare ISP','Anand (carpenter)'])[1 + floor(random() * 4)::int],
       round((150 + random() * 2500)::numeric, 2), c.created_at::date + 3
FROM complaints c WHERE c.status = 'resolved';

COMMIT;
ANALYZE;
