"""Generate the full Hostel OS production database (all 48 tables) as one psql-loadable SQL file.

Schema = Hostel OS's own Prisma migrations (copied into prisma_migrations/), plus the
_prisma_migrations bookkeeping rows, so the real Hostel OS app runs on this database unchanged.

Data  = one institution, 4 hostels, ~1,200 beds, ~1,450 students and 18 months of activity:
fees, challans, receipts, refunds, complaints, gate logs, roll calls, visitors, leave, mess bills,
meal plans, laundry, inventory, purchase orders, maintenance visits, notices and an audit trail.

Hidden problems (what DryRun must discover — the same stories as demo/hostel_seed.sql):
  * 3 double rooms have a third bed squeezed in and all 3 are occupied  → occupancy CHECK fails
  * 6 sibling pairs (12 students) registered with their parent's phone → UNIQUE(phone) fails
  * 8 September admissions have no guardian phone yet                 → SET NOT NULL fails
  * 92 payment amounts carry paise (₹58,000.50)                        → converting to integer rounds money
  * 2 beds are still flagged occupied although nobody is allocated     → drift for AI-written checks

Deterministic: the same seed always produces byte-identical output.

Usage:
  python demo/hostel_os/generate.py                    # writes demo/hostel_os/hostel_os.sql
  createdb -U postgres hostel
  psql -U postgres -d hostel -v ON_ERROR_STOP=1 -f demo/hostel_os/hostel_os.sql
"""
from __future__ import annotations

import hashlib
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIGRATIONS = sorted((HERE / "prisma_migrations").glob("*/migration.sql"))
OUT = HERE / "hostel_os.sql"

rng = random.Random(20260926)
TODAY = date(2026, 9, 26)
NOW = datetime(2026, 9, 26, 9, 30, 0)  # UTC ≈ 15:00 IST

# bcrypt hashes (bcryptjs, cost 10) of the demo passwords — same accounts as prisma/seed.ts
HASH = {
    "admin123": "$2a$10$d8sVdmz0HiZkNQgVwHn8qObrWnFA436V4y0zNp.K6O0xY03VQPSG2",
    "warden123": "$2a$10$hoYlRjWrPY4QmvT11Glt8OAIgw9HRlxXCCx1QQCmaevkZPK5tEK1e",
    "staff123": "$2a$10$980ym6BSl08vmkEciLQJU.VQGY7sorhL76pf9cyCRNuyEda/jGPfi",
    "student123": "$2a$10$Qr51wA6McsbyVKGvMdE6mu6s4sIIkFDRlEQGcRH0M7JxRl6zAH7sq",
}

# --------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------
_ids: dict[str, int] = {}


def cid(prefix: str) -> str:
    """cuid-shaped, deterministic id (25 chars, starts with 'c')."""
    _ids[prefix] = _ids.get(prefix, 0) + 1
    h = hashlib.sha1(f"{prefix}:{_ids[prefix]}".encode()).hexdigest()
    return "c" + h[:24]


def ts(d: datetime | date | None) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d %H:%M:%S.") + f"{d.microsecond // 1000:03d}"
    return d.strftime("%Y-%m-%d 00:00:00.000")


def ist(d: date, h: int, m: int = 0) -> datetime:
    """A wall-clock time in India, stored as UTC like the app does."""
    return datetime(d.year, d.month, d.day, h, m) - timedelta(hours=5, minutes=30)


def jitter(d: date, h0: int = 8, h1: int = 20) -> datetime:
    return ist(d, rng.randint(h0, h1 - 1), rng.randint(0, 59)) + timedelta(seconds=rng.randint(0, 59), milliseconds=rng.randint(0, 999))


def days(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def pick(seq, weights=None):
    return rng.choices(seq, weights=weights, k=1)[0] if weights else rng.choice(seq)


def chance(p: float) -> bool:
    return rng.random() < p


def phone() -> str:
    while True:
        n = f"{rng.choice('6789')}{rng.randint(0, 999_999_999):09d}"
        if n not in _phones:
            _phones.add(n)
            return f"+91 {n[:5]} {n[5:]}"


_phones: set[str] = set()


def money(x: float) -> float:
    return round(x, 2)


TABLES: dict[str, tuple[list[str], list[list]]] = {}


def table(name: str, cols: str):
    TABLES[name] = (cols.split(), [])
    return TABLES[name][1]


def esc(v) -> str:
    if v is None:
        return r"\N"
    if isinstance(v, bool):
        return "t" if v else "f"
    if isinstance(v, (datetime, date)):
        return ts(v)
    if isinstance(v, float):
        return repr(v) if v != int(v) else str(int(v))
    s = str(v)
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


# --------------------------------------------------------------------------------------------
# reference data
# --------------------------------------------------------------------------------------------
MALE = """Aarav Aditya Akash Amit Anand Aniket Arjun Arnav Ashwin Ayaan Bharath Chirag Darshan Deepak Dev Dhruv Farhan Gautam
Harsh Hemant Imran Ishaan Jatin Karthik Kabir Kiran Kunal Lokesh Manoj Mohit Naveen Nikhil Nitin Pranav Prasad Pratik Rahul
Rajat Rakesh Ravi Rohan Rohit Sachin Sahil Sai Sameer Sandeep Sanjay Shashank Shreyas Siddharth Sourav Srinivas Sudeep Suhas
Tarun Tejas Uday Varun Vedant Vignesh Vijay Vikram Vinay Vishal Vivek Yash Yogesh Zaid Abhishek Adarsh Ajay Alok Anirudh
Christopher Joel Joseph Mathew Nihal Omkar Parth Rehan Shoaib Tanmay""".split()
FEMALE = """Aditi Aishwarya Akshata Ananya Anjali Anusha Apoorva Bhavana Chaitra Deepika Diya Divya Fathima Gauri Harini Isha Ishita
Jyothi Kavya Keerthi Khushi Lakshmi Madhuri Meera Megha Nandini Neha Nikita Pallavi Pooja Prachi Priya Rachana Ramya Riya
Sahana Sakshi Samhita Sanjana Shreya Shruti Sindhu Sneha Soumya Swathi Tanvi Tejaswini Trisha Varsha Vidya Yamini Zoya Aarohi
Ankita Arpita Bhoomika Chandana Disha Esha Gayatri Hema Janani Kriti Lavanya Mansi Nisha Pavithra Rashmi Ritika Sana Sharanya
Shweta Simran Srushti Tanya Vaishnavi Anne Maria Sara Ayesha""".split()
SURNAMES = """Sharma Verma Gupta Iyer Iyengar Nair Menon Pillai Reddy Rao Naidu Shetty Hegde Kamath Bhat Patil Kulkarni Deshpande
Joshi Mehta Shah Patel Desai Singh Chauhan Rathore Yadav Mishra Tiwari Pandey Das Bose Banerjee Chatterjee Mukherjee Ghosh
Sen Roy Khan Sheikh Siddiqui Ansari Thomas Varghese George Mathew D'Souza Fernandes Pinto Gowda Murthy Prasad Kumar Jain
Agarwal Malhotra Kapoor Khanna Arora Saxena Srivastava Chaudhary Kaur Gill Sandhu Naik Pai Shenoy Acharya Krishnan Subramanian
Venkatesh Raghavan Hussain Qureshi Lobo Rodrigues""".split()
PLACES = [
    ("Mysuru", "Karnataka"), ("Mangaluru", "Karnataka"), ("Hubballi", "Karnataka"), ("Davanagere", "Karnataka"), ("Shivamogga", "Karnataka"),
    ("Belagavi", "Karnataka"), ("Tumakuru", "Karnataka"), ("Udupi", "Karnataka"), ("Chennai", "Tamil Nadu"), ("Coimbatore", "Tamil Nadu"),
    ("Madurai", "Tamil Nadu"), ("Hyderabad", "Telangana"), ("Warangal", "Telangana"), ("Vijayawada", "Andhra Pradesh"), ("Tirupati", "Andhra Pradesh"),
    ("Kochi", "Kerala"), ("Thiruvananthapuram", "Kerala"), ("Kozhikode", "Kerala"), ("Pune", "Maharashtra"), ("Nagpur", "Maharashtra"),
    ("Mumbai", "Maharashtra"), ("Patna", "Bihar"), ("Ranchi", "Jharkhand"), ("Kolkata", "West Bengal"), ("Bhubaneswar", "Odisha"),
    ("Lucknow", "Uttar Pradesh"), ("Jaipur", "Rajasthan"), ("Bhopal", "Madhya Pradesh"), ("Guwahati", "Assam"), ("Panaji", "Goa"),
]
STREETS = ["MG Road", "Temple Street", "Station Road", "Gandhi Nagar", "Nehru Colony", "Lake View Layout", "2nd Cross, Vidya Nagar",
           "4th Main, Jayanagar", "Church Road", "Market Road", "Civil Lines", "Shanti Nagar", "Ashok Nagar", "Rajiv Gandhi Road"]

UG = [("CS", "B.Tech Computer Science & Engineering"), ("AI", "B.Tech AI & Data Science"), ("EC", "B.Tech Electronics & Communication"),
      ("ME", "B.Tech Mechanical Engineering"), ("CV", "B.Tech Civil Engineering"), ("EE", "B.Tech Electrical & Electronics"),
      ("BB", "BBA"), ("BC", "B.Com (Hons)")]
UG_W = [26, 14, 16, 10, 7, 8, 11, 8]
PG = [("MB", "MBA"), ("MC", "MCA"), ("MV", "M.Tech VLSI Design"), ("MS", "M.Tech Software Engineering")]
PG_W = [40, 30, 15, 15]

ROOM_RENT = {"SINGLE": 72000, "DOUBLE": 58000, "TRIPLE": 49500, "QUAD": 42500}

# --------------------------------------------------------------------------------------------
# organisation, hostels, users
# --------------------------------------------------------------------------------------------
ORG = cid("org")
table("Organization", "id name plan status trialEndsAt integrations createdAt updatedAt").append(
    [ORG, "Kaveri Institute of Technology", "GROWTH", "ACTIVE", None, json.dumps(["RFID_GATE", "BIOMETRIC", "QR_MESS"]),
     datetime(2025, 11, 3, 6, 12, 44), datetime(2026, 7, 1, 4, 0, 0)])

HOSTELS = [
    # code, name, gender, level
    ("GNG", "Ganga Boys Hostel", "M", "UG"),
    ("YMN", "Yamuna Girls Hostel", "F", "UG"),
    ("KVR", "Kaveri Boys Hostel", "M", "MIX"),
    ("NMD", "Narmada Girls Hostel", "F", "MIX"),
]
hostels: list[dict] = []
H_ROWS = table("Hostel", "id orgId name code address capacity isActive createdAt updatedAt deletedAt")
BLOCK_ROWS = table("Block", "id hostelId name code createdAt updatedAt")
FLOOR_ROWS = table("Floor", "id blockId number name createdAt updatedAt")
ROOM_ROWS = table("Room", "id floorId number type capacity createdAt updatedAt")
BED_ROWS = table("Bed", "id roomId number isOccupied createdAt updatedAt")

FLOOR_PLAN = ["SINGLE"] * 2 + ["DOUBLE"] * 8 + ["TRIPLE"] * 4 + ["QUAD"] * 2   # 16 rooms, 38 beds per floor
CAP = {"SINGLE": 1, "DOUBLE": 2, "TRIPLE": 3, "QUAD": 4}
BUILT = datetime(2025, 11, 4, 5, 40, 0)

rooms: list[dict] = []
beds: list[dict] = []
for code, name, gender, level in HOSTELS:
    h = {"id": cid("hostel"), "code": code, "name": name, "gender": gender, "level": level, "rooms": [], "beds": []}
    hostels.append(h)
    for bcode in ("A", "B"):
        bid = cid("block")
        BLOCK_ROWS.append([bid, h["id"], f"Block {bcode}", bcode, BUILT, BUILT])
        for fl in range(1, 5):
            fid = cid("floor")
            FLOOR_ROWS.append([fid, bid, fl, ["Ground", "First", "Second", "Third", "Fourth"][fl] + " Floor", BUILT, BUILT])
            for i, rtype in enumerate(FLOOR_PLAN, start=1):
                r = {"id": cid("room"), "floor": fid, "hostel": h, "number": f"{bcode}-{fl}{i:02d}", "type": rtype, "capacity": CAP[rtype], "beds": []}
                rooms.append(r)
                h["rooms"].append(r)
                for bn in range(1, CAP[rtype] + 1):
                    b = {"id": cid("bed"), "room": r, "number": str(bn), "occupied": False}
                    r["beds"].append(b)
                    beds.append(b)
                    h["beds"].append(b)

# Hidden problem #1: a third bed squeezed into 3 double rooms during the mid-term rush.
OVERFULL = {("GNG", "A-204"), ("YMN", "B-307"), ("KVR", "A-409")}
for r in rooms:
    if (r["hostel"]["code"], r["number"]) in OVERFULL:
        b = {"id": cid("bed"), "room": r, "number": "3", "occupied": False, "extra": True}
        r["beds"].append(b)
        beds.append(b)
        r["hostel"]["beds"].append(b)

for h in hostels:
    cap = sum(r["capacity"] for r in h["rooms"])
    H_ROWS.append([h["id"], ORG, h["name"], h["code"], "Kengeri Campus, Mysuru Road, Bengaluru 560060", cap, True, BUILT, datetime(2026, 6, 20, 8, 0), None])

U_ROWS = table("User", "id email passwordHash name phone role hostelId orgId isActive lastLoginAt createdAt updatedAt deletedAt")
users: list[dict] = []


def add_user(email, pw, name, role, hostel=None, title=None, active=True, created=datetime(2025, 11, 5, 6, 0)):
    u = {"id": cid("user"), "email": email, "name": name, "role": role, "hostel": hostel, "title": title}
    last = NOW - timedelta(hours=rng.randint(1, 60), minutes=rng.randint(0, 59)) if active else None
    U_ROWS.append([u["id"], email, HASH[pw], name, phone(), role, hostel["id"] if hostel else None, ORG, active, last, created, created + timedelta(days=30), None])
    users.append(u)
    return u


H = {h["code"]: h for h in hostels}
admin = add_user("admin@hms.local", "admin123", "Anita Desai", "ADMIN", title="Chief Hostel Administrator")
wardens = [
    add_user("warden@hms.local", "warden123", "Ramesh Gowda", "WARDEN", H["GNG"], "Warden, Ganga"),
    add_user("warden.yamuna@hms.local", "warden123", "Lakshmi Rao", "WARDEN", H["YMN"], "Warden, Yamuna"),
    add_user("warden.kaveri@hms.local", "warden123", "Joseph Mathew", "WARDEN", H["KVR"], "Warden, Kaveri"),
    add_user("warden.narmada@hms.local", "warden123", "Farah Khan", "WARDEN", H["NMD"], "Warden, Narmada"),
]
WARDEN_OF = {w["hostel"]["code"]: w for w in wardens}
staff = {
    "desk": add_user("staff@hms.local", "staff123", "Priya Shenoy", "STAFF", H["GNG"], "Front desk"),
    "desk2": add_user("frontdesk.yamuna@hms.local", "staff123", "Kavitha Nair", "STAFF", H["YMN"], "Front desk"),
    "electric": add_user("suresh.electrician@hms.local", "staff123", "Suresh Kumar", "STAFF", None, "Electrician"),
    "plumber": add_user("ravi.plumber@hms.local", "staff123", "Ravi Naik", "STAFF", None, "Plumber"),
    "carpenter": add_user("anand.carpenter@hms.local", "staff123", "Anand Acharya", "STAFF", None, "Carpenter"),
    "house1": add_user("housekeeping.ganga@hms.local", "staff123", "Manjula Devi", "STAFF", H["GNG"], "Housekeeping lead"),
    "house2": add_user("housekeeping.yamuna@hms.local", "staff123", "Shobha Kamath", "STAFF", H["YMN"], "Housekeeping lead"),
    "mess": add_user("mess.manager@hms.local", "staff123", "Venkatesh Iyer", "STAFF", None, "Mess manager"),
    "it": add_user("it.support@hms.local", "staff123", "Nikhil Pai", "STAFF", None, "Network & Wi-Fi"),
    "security": add_user("security.chief@hms.local", "staff123", "Havildar Basavaraj", "STAFF", None, "Chief of security"),
    "accounts": add_user("accounts@hms.local", "staff123", "Deepa Hegde", "STAFF", None, "Accounts officer"),
    "store": add_user("store.keeper@hms.local", "staff123", "Mahesh Shetty", "STAFF", None, "Store keeper"),
}
add_user("former.warden@hms.local", "warden123", "Prakash Joshi", "WARDEN", None, "Former warden", active=False, created=datetime(2025, 11, 5, 6, 0))
STAFF_IDS = [u["id"] for u in list(staff.values()) + wardens]

# --------------------------------------------------------------------------------------------
# students
# --------------------------------------------------------------------------------------------
S_ROWS = table("Student", "id orgId userId rollNumber name email phone course year guardianName guardianPhone address photoUrl admissionDate isActive createdAt updatedAt deletedAt")
students: list[dict] = []
_emails: set[str] = set()
_roll_seq: dict[str, int] = {}


def new_student(hostel: dict, admit: date, *, active=True, level=None) -> dict:
    gender = hostel["gender"]
    first = pick(MALE if gender == "M" else FEMALE)
    last = pick(SURNAMES)
    lvl = level or ("UG" if hostel["level"] == "UG" else pick(["UG", "PG"], [55, 45]))
    dept, course = pick(PG, PG_W) if lvl == "PG" else pick(UG, UG_W)
    key = f"{dept}{admit.year}"
    _roll_seq[key] = _roll_seq.get(key, 0) + 1
    roll = f"{dept}{admit.year}{_roll_seq[key]:03d}"
    base = f"{first}.{last}".lower().replace("'", "")
    email, n = f"{base}@kit.edu.in", 1
    while email in _emails:
        n += 1
        email = f"{base}{n}@kit.edu.in"
    _emails.add(email)
    span = 2 if lvl == "PG" else 4
    year = min(span, (TODAY.year - admit.year) + (1 if TODAY.month >= 7 else 0)) if active else span
    year = max(1, year)
    city, state = pick(PLACES)
    s = {
        "id": cid("student"), "hostel": hostel, "roll": roll, "name": f"{first} {last}", "first": first, "last": last,
        "email": email, "phone": phone(), "course": course, "year": year, "level": lvl,
        "guardian": f"{pick(MALE)} {last}" if chance(0.8) else f"{pick(FEMALE)} {last}", "gphone": phone(),
        "address": f"{rng.randint(1, 480)}, {pick(STREETS)}, {city}, {state} {rng.randint(500001, 699999)}",
        "admit": admit, "active": active, "deleted": None, "user": None, "bed": None, "rent": 0,
    }
    students.append(s)
    return s


def admit_date(y: int) -> date:
    return date(y, 7, 1) + timedelta(days=rng.randint(0, 40))


# current residents: ~90% of every hostel, by batch
for h in hostels:
    free = list(h["beds"])
    target = int(len([b for b in free if not b.get("extra")]) * rng.uniform(0.88, 0.93))
    for i in range(target):
        if h["level"] == "UG":
            y = pick([2023, 2024, 2025, 2026], [22, 25, 26, 27])
            s = new_student(h, admit_date(y), level="UG")
        else:
            lvl = pick(["UG", "PG"], [55, 45])
            y = pick([2023, 2024, 2025, 2026], [22, 25, 26, 27]) if lvl == "UG" else pick([2025, 2026], [48, 52])
            s = new_student(h, admit_date(y), level=lvl)

# alumni (graduated, allocations ended) and dropouts (soft-deleted)
for h in hostels:
    for _ in range(75):
        lvl = "UG" if h["level"] == "UG" else pick(["UG", "PG"], [55, 45])
        y = pick([2021, 2022]) if lvl == "UG" else pick([2023, 2024])
        new_student(h, admit_date(y), active=False, level=lvl)
for h in hostels:
    for _ in range(2):
        s = new_student(h, admit_date(pick([2024, 2025])), active=False)
        s["deleted"] = datetime(2026, rng.randint(1, 5), rng.randint(1, 28), 7, 15)

# September 2026 lateral admissions still waiting for a bed (20); 8 have no guardian phone yet (#3)
waitlist = []
for i in range(20):
    h = hostels[i % 4]
    s = new_student(h, date(2026, 9, 1) + timedelta(days=rng.randint(0, 22)), level="UG")
    s["year"] = 1
    waitlist.append(s)
for s in waitlist[:8]:
    s["gphone"] = None
    s["guardian"] = None

# Hidden problem #2: 6 sibling pairs registered with their parent's mobile number
residents = [s for s in students if s["active"] and s not in waitlist]
pairs = []
for h in hostels:
    pool = [s for s in residents if s["hostel"] is h]
    rng.shuffle(pool)
    pairs += [(pool[0], pool[1]), (pool[2], pool[3])] if h["code"] in ("GNG", "YMN") else [(pool[0], pool[1])]
for a, b in pairs:
    b["last"] = a["last"]
    b["name"] = f"{b['first']} {a['last']}"
    b["guardian"], b["gphone"] = a["guardian"], a["gphone"]
    b["address"] = a["address"]
    a["phone"] = b["phone"] = a["gphone"]
    a["sibling_note"] = b["sibling_note"] = True

# student logins for ~8% of residents (the student app / kiosk)
STU_USERS = []
for s in residents[::12]:
    u = {"id": cid("user"), "email": s["email"], "name": s["name"], "role": "STUDENT", "hostel": s["hostel"]}
    U_ROWS.append([u["id"], s["email"], HASH["student123"], s["name"], s["phone"], "STUDENT", s["hostel"]["id"], ORG, True,
                   NOW - timedelta(hours=rng.randint(1, 200)), datetime.combine(s["admit"], datetime.min.time()) + timedelta(hours=6), NOW - timedelta(days=rng.randint(1, 40)), None])
    users.append(u)
    s["user"] = u["id"]
    STU_USERS.append(u)

for s in students:
    created = datetime.combine(s["admit"], datetime.min.time()) + timedelta(hours=rng.randint(4, 11), minutes=rng.randint(0, 59))
    S_ROWS.append([s["id"], ORG, s["user"], s["roll"], s["name"], s["email"], s["phone"], s["course"], s["year"], s["guardian"], s["gphone"],
                   s["address"], None, created, s["active"] and not s["deleted"], created, s["deleted"] or created + timedelta(days=rng.randint(0, 60)), s["deleted"]])

# --------------------------------------------------------------------------------------------
# allocations
# --------------------------------------------------------------------------------------------
A_ROWS = table("Allocation", "id studentId bedId startDate endDate status notes createdAt updatedAt")
for h in hostels:
    free = [b for b in h["beds"] if not b.get("extra")]
    rng.shuffle(free)
    mine = [s for s in residents if s["hostel"] is h]
    # seniors get singles first
    mine.sort(key=lambda s: (s["admit"], s["roll"]))
    singles = [b for b in free if b["room"]["type"] == "SINGLE"]
    others = [b for b in free if b["room"]["type"] != "SINGLE"]
    order = singles + others
    for s, b in zip(mine, order):
        s["bed"] = b
        b["occupied"] = True
    extras = [b for b in h["beds"] if b.get("extra")]
    # the 3 overfull rooms: move one more resident into the squeezed-in bed
    for b in extras:
        s = next(x for x in reversed(mine) if x["bed"] and x["bed"]["room"]["type"] != "DOUBLE" and x["admit"] >= date(2026, 7, 1))
        s["bed"]["occupied"] = False
        s["bed"] = b
        b["occupied"] = True
        s["mid_term"] = True

for s in students:
    if s["bed"]:
        s["rent"] = ROOM_RENT[s["bed"]["room"]["type"]]
        # ~12% changed rooms at least once: an ENDED allocation on another bed first
        start = datetime.combine(s["admit"], datetime.min.time()) + timedelta(hours=6)
        if s["admit"] < date(2026, 1, 1) and chance(0.12):
            prev = pick([b for b in s["hostel"]["beds"] if b is not s["bed"]])
            moved = s["admit"] + timedelta(days=rng.randint(60, (TODAY - s["admit"]).days - 20))
            A_ROWS.append([cid("alloc"), s["id"], prev["id"], start, datetime.combine(moved, datetime.min.time()) + timedelta(hours=5), "ENDED",
                           pick(["Room change: requested a quieter floor", "Room change: roommate conflict resolved by warden",
                                 "Room change: moved closer to the lift (medical)", "Shifted during bathroom renovation"]), start, start + timedelta(days=5)])
            start = datetime.combine(moved, datetime.min.time()) + timedelta(hours=5, minutes=30)
        # academic-year renewal for continuing students
        if s["admit"] < date(2026, 6, 1) and not s.get("mid_term"):
            A_ROWS.append([cid("alloc"), s["id"], s["bed"]["id"], start, datetime(2026, 5, 31, 12, 0), "ENDED", "Academic year 2025-26", start, datetime(2026, 5, 31, 12, 0)])
            start = datetime(2026, 7, 1, 5, 0) + timedelta(days=rng.randint(0, 20), minutes=rng.randint(0, 300))
        note = None
        if s.get("mid_term"):
            start = datetime(2026, 8, rng.randint(18, 29), rng.randint(4, 12), rng.randint(0, 59))
            note = "Temporary third bed — mid-term admissions rush, shift when a bed frees up"
        A_ROWS.append([cid("alloc"), s["id"], s["bed"]["id"], start, None, "ACTIVE", note, start, start + timedelta(days=rng.randint(0, 10))])
    elif not s["active"]:
        b = pick(s["hostel"]["beds"])
        start = datetime.combine(s["admit"], datetime.min.time()) + timedelta(hours=6)
        if s["deleted"]:
            A_ROWS.append([cid("alloc"), s["id"], b["id"], start, s["deleted"], "CANCELLED", "Withdrew from the programme", start, s["deleted"]])
        else:
            grad = date(s["admit"].year + (2 if s["level"] == "PG" else 4), 5, rng.randint(20, 31))
            A_ROWS.append([cid("alloc"), s["id"], b["id"], start, datetime.combine(grad, datetime.min.time()) + timedelta(hours=6), "ENDED", "Graduated — room vacated", start, datetime.combine(grad, datetime.min.time())])

# Hidden problem #5: two beds still flagged occupied after their student moved out
ghosts = [b for b in beds if not b["occupied"] and b["room"]["type"] == "TRIPLE"][:2]
for b in ghosts:
    b["occupied"] = True

for r in rooms:
    ROOM_ROWS.append([r["id"], r["floor"], r["number"], r["type"], r["capacity"], BUILT, BUILT])
for b in beds:
    upd = BUILT if not b["occupied"] else datetime(2026, 7, 1, 5, 0) + timedelta(days=rng.randint(0, 60))
    BED_ROWS.append([b["id"], b["room"]["id"], b["number"], b["occupied"], datetime(2026, 8, 17, 10, 5) if b.get("extra") else BUILT, upd])

# --------------------------------------------------------------------------------------------
# simple fee ledger (Payment) — hidden problem #4 lives here
# --------------------------------------------------------------------------------------------
P_ROWS = table("Payment", "id studentId amount type status method dueDate paidDate transactionId notes createdAt updatedAt")
METHODS = ["UPI", "NETBANKING", "CARD", "CASH", "CHEQUE"]
METHOD_W = [55, 20, 10, 8, 7]
_txn = [0]


def txn(method: str, when: date) -> str | None:
    _txn[0] += 1
    if method == "CASH":
        return None
    prefix = {"UPI": "UPI", "NETBANKING": "NB", "CARD": "CRD", "CHEQUE": "CHQ"}[method]
    return f"{prefix}{when.strftime('%y%m%d')}{rng.randint(100000, 999999)}{_txn[0] % 97:02d}"


def pay(s, amount, ptype, due: date, *, p_paid=0.97, note=None, created=None):
    paid_d = None
    status = "PAID" if chance(p_paid) else ("OVERDUE" if due < TODAY else "PENDING")
    method = transaction = None
    if status == "PAID":
        paid_d = due - timedelta(days=rng.randint(-12, 25))
        paid_d = min(paid_d, TODAY)
        method = pick(METHODS, METHOD_W)
        transaction = txn(method, paid_d)
    c = created or datetime.combine(due - timedelta(days=30), datetime.min.time()) + timedelta(hours=4)
    u = jitter(paid_d) if paid_d else c
    row = [cid("pay"), s["id"], float(amount), ptype, status, method, datetime.combine(due, datetime.min.time()) + timedelta(hours=18, minutes=30),
           jitter(paid_d) if paid_d else None, transaction, note, c, u]
    P_ROWS.append(row)
    return row


SEMS = [(date(2024, 7, 15), "Odd 2024"), (date(2025, 1, 15), "Even 2025"), (date(2025, 7, 15), "Odd 2025"), (date(2026, 1, 15), "Even 2026"), (date(2026, 7, 15), "Odd 2026")]
MESS_MONTHS = [date(2026, m, 5) for m in (4, 5, 6, 7, 8, 9)] + [date(2026, 10, 5)]
for s in students:
    stay_end = TODAY if s["active"] else date(s["admit"].year + (2 if s["level"] == "PG" else 4), 5, 31)
    if s["deleted"]:
        stay_end = s["deleted"].date()
    pay(s, 15000, "SECURITY_DEPOSIT", s["admit"] + timedelta(days=3), p_paid=0.995 if s["bed"] or not s["active"] else 0.6,
        note="Caution deposit (refundable)", created=datetime.combine(s["admit"], datetime.min.time()) + timedelta(hours=5))
    rent = s["rent"] or ROOM_RENT[pick(["DOUBLE", "TRIPLE", "QUAD"])]
    for due, label in SEMS:
        if s["admit"] - timedelta(days=45) <= due <= stay_end:
            recent = due == date(2026, 7, 15)
            pay(s, rent / 2, "HOSTEL_FEE", due, p_paid=0.83 if recent else 0.995, note=f"Hostel fee — {label}")
    if s["active"] and (s["bed"] or s in waitlist):
        for due in MESS_MONTHS:
            if due >= s["admit"] - timedelta(days=5):
                p = 0.0 if due > TODAY else (0.86 if due.month == 9 else 0.985)
                pay(s, 4200 if s["hostel"]["code"] != "NMD" else 4600, "MESS_FEE", due, p_paid=p, note=f"Mess fee — {due.strftime('%B %Y')}")
    elif not s["active"] and not s["deleted"]:
        r = pay(s, 15000, "SECURITY_DEPOSIT", stay_end + timedelta(days=20), p_paid=1.0, note="Caution deposit refunded after room inspection")
        r[4] = "REFUNDED"
    if chance(0.09):
        why, amt = pick([("Late entry after 10:30 PM curfew", 500), ("Damage to room furniture", 1500), ("Lost room key", 300),
                         ("Unauthorised electrical appliance (kettle)", 1000), ("Guest overstay without permission", 750)])
        pay(s, amt, "FINE", s["admit"] + timedelta(days=rng.randint(30, max(31, (stay_end - s["admit"]).days))), p_paid=0.8, note=why)

# #4: 92 amounts with paise — pro-rata joins and partial refunds adjusted by the accounts team
cands = [r for r in P_ROWS if r[3] in ("HOSTEL_FEE", "MESS_FEE") and r[1]]
for r in rng.sample(cands, 92):
    r[2] = r[2] + pick([0.25, 0.5, 0.75])
    r[9] = (r[9] or "") + pick([" · pro-rated for mid-month join", " · adjusted after partial refund", " · late fee waiver (50%) applied"])

# --------------------------------------------------------------------------------------------
# complaints
# --------------------------------------------------------------------------------------------
C_ROWS = table("Complaint", "id studentId title description category priority status assignedToId resolvedAt resolution createdAt updatedAt")
CATS = {
    "ELECTRICAL": ("electric", [("Fan not working", "Ceiling fan in {room} stopped working since last night. It hums but does not spin."),
                                ("Tube light flickering", "The tube light near the study table in {room} keeps flickering and gives a headache."),
                                ("Power socket sparking", "The socket next to bed {bed} sparked when I plugged in my laptop charger. Please check urgently."),
                                ("No power in room", "Whole room {room} has no power since 7 PM; neighbouring rooms are fine.")]),
    "PLUMBING": ("plumber", [("Tap leaking in bathroom", "Bathroom tap on floor {floor} keeps dripping, water is being wasted all night."),
                             ("No hot water", "Geyser in the {block} wing bathroom is not heating water in the mornings."),
                             ("Blocked drain", "The shower drain is blocked and water collects ankle deep."),
                             ("Flush not working", "Toilet flush in the corner washroom near {room} is broken.")]),
    "WIFI": ("it", [("Wi-Fi drops every evening", "Wi-Fi disconnects every evening between 9 and 11 PM in {room}; online classes and submissions are affected."),
                    ("Very slow internet", "Speed test shows under 1 Mbps on floor {floor}. Cannot download lab files."),
                    ("Cannot log in to captive portal", "Portal says 'device limit reached' though I use only my laptop.")]),
    "MAINTENANCE": ("carpenter", [("Broken chair", "Study chair in {room} has a broken leg."), ("Cupboard lock jammed", "Cupboard lock of bed {bed} is jammed; my documents are inside."),
                                  ("Window glass cracked", "Window pane in {room} is cracked, rain water comes in."), ("Door hinge loose", "Main door of {room} does not close properly.")]),
    "CLEANLINESS": ("house1", [("Room not cleaned", "Housekeeping has skipped {room} for the last three days."), ("Washroom not cleaned", "Common washroom on floor {floor} is dirty since morning."),
                               ("Garbage not collected", "Dustbin in the corridor near {room} is overflowing.")]),
    "MESS": ("mess", [("Food quality issue", "Dal at dinner was sour today, several of us felt unwell."), ("Insect found in food", "Found an insect in the rice at lunch. Photo shared with the mess committee."),
                      ("Breakfast ran out early", "Breakfast was over by 8:40 AM though timing is till 9:30.")]),
    "SECURITY": ("security", [("Unknown person in corridor", "An unknown person was roaming on floor {floor} around midnight."),
                              ("CCTV not working", "The CCTV near the {block} block entrance has been off for two days."),
                              ("Bicycle stolen", "My bicycle was stolen from the parking shed despite being locked.")]),
    "OTHER": ("desk", [("Need extra mattress", "Requesting an extra mattress for a visiting parent staying two days."), ("Room key duplicate", "I need a duplicate key for {room}."),
                       ("Noise from next room", "Loud music from the neighbouring room after 11 PM every day.")]),
}
CAT_W = {"ELECTRICAL": 16, "PLUMBING": 16, "WIFI": 18, "MAINTENANCE": 14, "CLEANLINESS": 12, "MESS": 12, "SECURITY": 4, "OTHER": 8}
RESOLUTIONS = {"electric": "Replaced the faulty part and tested.", "plumber": "Plumber fixed the leak / cleared the line.", "it": "Access point rebooted and channel changed; speed verified at 40+ Mbps.",
               "carpenter": "Carpenter repaired / replaced the fitting.", "house1": "Housekeeping schedule corrected; area cleaned.", "mess": "Discussed with the mess contractor; vendor warned and menu audited.",
               "security": "Security informed; guard rounds increased and CCTV restored.", "desk": "Handled at the front desk."}
start = date(2025, 1, 6)
for s in [x for x in students if x["bed"] or not x["active"]]:
    n = rng.choices([0, 1, 2, 3], [40, 35, 18, 7])[0]
    for _ in range(n):
        lo = max(start, s["admit"] + timedelta(days=7))
        hi = TODAY if s["active"] else date(s["admit"].year + (2 if s["level"] == "PG" else 4), 5, 25)
        if hi <= lo:
            continue
        created_d = lo + timedelta(days=rng.randint(0, (hi - lo).days))
        cat = pick(list(CAT_W), list(CAT_W.values()))
        who, templates = CATS[cat]
        title, desc = pick(templates)
        room = s["bed"]["room"] if s["bed"] else pick(s["hostel"]["rooms"])
        desc = desc.format(room=room["number"], bed=room["number"] + "/" + (s["bed"]["number"] if s["bed"] else "1"), floor=room["number"][2], block=room["number"][0])
        age = (TODAY - created_d).days
        prio = "URGENT" if "sparking" in title or "stolen" in title or "Insect" in title else pick(["LOW", "MEDIUM", "HIGH"], [25, 55, 20])
        if age > 20:
            status = pick(["RESOLVED", "CLOSED", "REJECTED"], [55, 40, 5])
        elif age > 5:
            status = pick(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"], [10, 25, 45, 20])
        else:
            status = pick(["OPEN", "IN_PROGRESS", "RESOLVED"], [55, 35, 10])
        assignee = staff[who]["id"] if status != "OPEN" or chance(0.3) else None
        c_at = jitter(created_d, 7, 23)
        res_at = c_at + timedelta(hours=rng.randint(2, 96)) if status in ("RESOLVED", "CLOSED") else None
        res = RESOLUTIONS[who] if res_at else ("Duplicate of an earlier ticket" if status == "REJECTED" else None)
        C_ROWS.append([cid("complaint"), s["id"], title, desc, cat, prio, status, assignee, res_at, res, c_at, res_at or c_at + timedelta(hours=rng.randint(0, 30))])

# --------------------------------------------------------------------------------------------
# leave, gate attendance, daily roll call, visitors
# --------------------------------------------------------------------------------------------
L_ROWS = table("LeaveRequest", "id studentId fromDate toDate reason destination status reviewedById reviewedAt reviewNote createdAt updatedAt leaveType")
on_leave: dict[str, set[date]] = {}
REASONS = {"CASUAL": ["Going home for the long weekend", "Sister's wedding", "Family function", "Dasara holidays at home", "Visiting grandparents"],
           "SICK": ["Fever — going home to recover", "Doctor advised rest after viral infection", "Dental surgery follow-up"],
           "PERMISSION": ["Hackathon at IISc, returning late", "Internship interview in the city", "Industrial visit with department", "NSS camp"],
           "OTHER": ["Passport appointment", "Bank work at home town", "Driving licence test"]}
for s in [x for x in students if x["bed"]]:
    for _ in range(rng.choices([0, 1, 2, 3], [35, 40, 18, 7])[0]):
        lt = pick(list(REASONS), [45, 20, 25, 10])
        f = date(2026, 3, 1) + timedelta(days=rng.randint(0, (TODAY - date(2026, 3, 1)).days + 20))
        if f < s["admit"]:
            continue
        t = f + timedelta(days=0 if lt == "PERMISSION" else rng.randint(1, 6))
        created = jitter(f - timedelta(days=rng.randint(1, 7)))
        if f > TODAY:
            status = pick(["PENDING", "APPROVED"], [60, 40])
        else:
            status = pick(["APPROVED", "REJECTED"], [88, 12])
        w = WARDEN_OF[s["hostel"]["code"]]
        rev = created + timedelta(hours=rng.randint(1, 30)) if status != "PENDING" else None
        note = None if status == "PENDING" else ("Approved. Sign the movement register at the gate." if status == "APPROVED" else pick(["Exams during this period", "Parent confirmation not received"]))
        L_ROWS.append([cid("leave"), s["id"], datetime.combine(f, datetime.min.time()), datetime.combine(t, datetime.min.time()), pick(REASONS[lt]),
                       s["address"].split(", ")[-2] if lt != "PERMISSION" else "Bengaluru", status, w["id"] if rev else None, rev, note, created, rev or created, lt])
        if status == "APPROVED":
            on_leave.setdefault(s["id"], set()).update(days(f, t))

AT_ROWS = table("Attendance", "id studentId type method timestamp notes createdAt")
SDA_ROWS = table("StudentDailyAttendance", "id orgId studentId hostelId attendanceDate status createdById createdAt")
live = [s for s in students if s["bed"]]
for d in days(TODAY - timedelta(days=29), TODAY - timedelta(days=1)):
    for s in live:
        if d < (s["admit"] + timedelta(days=1)):
            continue
        leave = d in on_leave.get(s["id"], ())
        status = "LEAVE" if leave else ("ABSENT" if chance(0.025) else "PRESENT")
        SDA_ROWS.append([cid("sda"), ORG, s["id"], s["hostel"]["id"], datetime.combine(d, datetime.min.time()), status, WARDEN_OF[s["hostel"]["code"]]["id"], ist(d, 22, rng.randint(0, 40))])
        if d >= TODAY - timedelta(days=20) and not leave and chance(0.38):
            out = ist(d, rng.randint(16, 19), rng.randint(0, 59))
            back = out + timedelta(minutes=rng.randint(45, 280))
            late = back > ist(d, 22, 30)
            m = pick(["RFID", "QR", "MANUAL"], [62, 28, 10])
            AT_ROWS.append([cid("att"), s["id"], "EXIT", m, out, None, out])
            AT_ROWS.append([cid("att"), s["id"], "ENTRY", m, back, "Late entry — reported to warden" if late else None, back])
# today so far: a few out right now
for s in rng.sample(live, 140):
    out = ist(TODAY, rng.randint(8, 14), rng.randint(0, 59))
    AT_ROWS.append([cid("att"), s["id"], "EXIT", pick(["RFID", "QR"]), out, None, out])

V_ROWS = table("Visitor", "id studentId name phone relation purpose entryTime exitTime createdAt updatedAt")
for s in rng.sample(live, 900):
    for _ in range(rng.choices([1, 2, 3], [70, 22, 8])[0]):
        rel = pick(["Father", "Mother", "Brother", "Sister", "Uncle", "Friend", "Cousin"], [30, 28, 10, 10, 8, 9, 5])
        nm = (pick(MALE) if rel in ("Father", "Brother", "Uncle") else pick(FEMALE) if rel in ("Mother", "Sister") else pick(MALE + FEMALE)) + " " + (s["last"] if rel not in ("Friend",) else pick(SURNAMES))
        d = TODAY - timedelta(days=rng.randint(1, 180))
        if d < s["admit"]:
            d = s["admit"] + timedelta(days=1)
        e = ist(d, rng.randint(9, 17), rng.randint(0, 59))
        V_ROWS.append([cid("visitor"), s["id"], nm, phone(), rel, pick(["Weekend visit", "Dropping home food", "Fee payment", "Medical visit", "Collecting documents", "Parent-teacher meeting"]),
                       e, e + timedelta(minutes=rng.randint(20, 180)), e, e + timedelta(minutes=rng.randint(20, 180))])
for s in rng.sample(live, 6):  # currently inside the campus
    e = ist(TODAY, rng.randint(10, 14), rng.randint(0, 59))
    V_ROWS.append([cid("visitor"), s["id"], pick(MALE) + " " + s["last"], phone(), "Father", "Weekend visit", e, None, e, e])

# --------------------------------------------------------------------------------------------
# ERP fee management: fee types, structures, challans, receipts, refunds
# --------------------------------------------------------------------------------------------
FT_ROWS = table("FeeType", "id orgId name isActive createdAt updatedAt")
SFT_ROWS = table("SubFeeType", "id orgId feeTypeId name isActive createdAt updatedAt")
FS_ROWS = table("FeeStructure", "id orgId hostelId feeTypeId subFeeTypeId amount refundableType createdAt updatedAt")
FEE_TREE = {"Hostel Fee": [("Room Rent", None), ("Electricity", 4200), ("Water", 1500), ("Wi-Fi", 2400)],
            "Mess Fee": [("Mess Advance", 25200)], "Security Deposit": [("Caution Deposit", 15000)],
            "Maintenance Fee": [("Annual Maintenance", 3500), ("Housekeeping", 2800)]}
ft_id, sft = {}, {}
for ft, subs in FEE_TREE.items():
    ft_id[ft] = cid("feetype")
    FT_ROWS.append([ft_id[ft], ORG, ft, True, BUILT, BUILT])
    for sub, _ in subs:
        sft[sub] = cid("subfee")
        SFT_ROWS.append([sft[sub], ORG, ft_id[ft], sub, True, BUILT, BUILT])
for h in hostels:
    for ft, subs in FEE_TREE.items():
        for sub, amt in subs:
            a = 29000 if amt is None else amt  # room rent varies by room type; the structure holds the double-room semester rate
            FS_ROWS.append([cid("feestruct"), ORG, h["id"], ft_id[ft], sft[sub], float(a + (500 if h["code"] == "NMD" and amt else 0)),
                            "REFUNDABLE" if sub == "Caution Deposit" else "NON_REFUNDABLE", BUILT, BUILT])

CH_ROWS = table("Challan", "id orgId challanNo studentId hostelId feeTypeId totalFee totalPayable challanDate collectionStatus generatedById createdAt updatedAt deletedAt")
CI_ROWS = table("ChallanItem", "id orgId challanId subFeeTypeId amount createdAt")
RC_ROWS = table("Receipt", "id orgId receiptNo challanId amountPaid mop utrNo collectionDate collectedById createdAt")
ch_no = rc_no = 0
for sem_date, label in [(date(2026, 1, 2), "EVEN-2026"), (date(2026, 7, 1), "ODD-2026")]:
    for s in live:
        if s["admit"] > sem_date + timedelta(days=40):
            continue
        ch_no += 1
        items = [("Room Rent", s["rent"] / 2), ("Electricity", 4200), ("Water", 1500), ("Wi-Fi", 2400)]
        total = float(sum(a for _, a in items))
        cdate = datetime.combine(sem_date, datetime.min.time()) + timedelta(hours=5, minutes=rng.randint(0, 50))
        cid_ = cid("challan")
        recent = label == "ODD-2026"
        st = pick(["PAID", "PARTIALLY_PAID", "PENDING"], [80, 9, 11]) if recent else pick(["PAID", "PARTIALLY_PAID"], [98, 2])
        CH_ROWS.append([cid_, ORG, f"KIT/HST/{label}/{ch_no:05d}", s["id"], s["hostel"]["id"], ft_id["Hostel Fee"], total, total, cdate, st, staff["accounts"]["id"], cdate, cdate + timedelta(days=rng.randint(1, 40)), None])
        for sub, a in items:
            CI_ROWS.append([cid("challanitem"), ORG, cid_, sft[sub], float(a), cdate])
        parts = [] if st == "PENDING" else ([total] if st == "PAID" and chance(0.85) else ([round(total * 0.5), total - round(total * 0.5)] if st == "PAID" else [round(total * rng.choice([0.4, 0.5, 0.6]))]))
        pd = sem_date + timedelta(days=rng.randint(3, 30))
        for amt in parts:
            rc_no += 1
            mop = pick(["ONLINE", "NEFT", "CASH", "CHEQUE"], [60, 22, 10, 8])
            when = jitter(min(pd, TODAY))
            RC_ROWS.append([cid("receipt"), ORG, f"KIT/RCT/{rc_no:06d}", cid_, float(amt), mop, None if mop == "CASH" else f"UTR{rng.randint(10**11, 10**12 - 1)}", when, staff["accounts"]["id"], when])
            pd += timedelta(days=rng.randint(15, 40))

RF_ROWS = table("Refund", "id orgId studentId challanId refundType refundAmount bankName accountHolderName branch accountNo ifscCode utrNo refundDate processedById createdAt updatedAt deletedAt")
BANKS = [("State Bank of India", "SBIN0"), ("Canara Bank", "CNRB0"), ("HDFC Bank", "HDFC0"), ("ICICI Bank", "ICIC0"), ("Axis Bank", "UTIB0"), ("Bank of Baroda", "BARB0"), ("Karnataka Bank", "KARB0")]
for s in [x for x in students if not x["active"] and not x["deleted"]]:
    if chance(0.12):
        continue  # still pending refund paperwork
    bank, pfx = pick(BANKS)
    grad = date(s["admit"].year + (2 if s["level"] == "PG" else 4), 6, 1) + timedelta(days=rng.randint(5, 45))
    city = s["address"].split(", ")[-2]
    RF_ROWS.append([cid("refund"), ORG, s["id"], None, "DEPOSIT", 15000.0 - pick([0, 0, 0, 500, 1200]), bank, s["guardian"] or s["name"], f"{city} Main", f"{rng.randint(10**10, 10**12 - 1)}",
                    f"{pfx}{rng.randint(10000, 99999):06d}"[:11], f"UTR{rng.randint(10**11, 10**12 - 1)}", jitter(grad), staff["accounts"]["id"], jitter(grad - timedelta(days=4)), jitter(grad), None])

# --------------------------------------------------------------------------------------------
# inventory & procurement
# --------------------------------------------------------------------------------------------
SUP_ROWS = table("Supplier", "id orgId name gstin mobile email address isActive createdAt updatedAt")
suppliers = []
for n, e in [("Annapurna Provisions", "sales@annapurna.in"), ("FreshDaily Vegetables", None), ("Nandini Dairy Distributors", "orders@nandinidist.in"),
             ("Sri Lakshmi Rice Traders", "slrt.traders@gmail.com"), ("CleanPro Housekeeping Supplies", "cleanpro.blr@gmail.com"), ("Vijay Electricals", "vijayelec@yahoo.in"),
             ("Kaveri Hardware & Plumbing", None), ("SleepWell Mattress Co.", "b2b@sleepwell.co.in"), ("Metro Gas Agency", None), ("Om Sai Stationers", "omsai.stationers@gmail.com")]:
    i = cid("supplier")
    suppliers.append(i)
    SUP_ROWS.append([i, ORG, n, f"29{''.join(rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ') for _ in range(5))}{rng.randint(1000, 9999)}{rng.choice('ABCDEFGHJK')}1Z{rng.randint(1, 9)}",
                     phone(), e, f"{rng.randint(1, 300)}, {pick(['KR Market', 'Yeshwanthpur APMC Yard', 'Chickpet', 'Peenya Industrial Area', 'Rajajinagar', 'Kengeri'])}, Bengaluru", True, BUILT, BUILT])
UOM_ROWS = table("Uom", "id orgId name isActive createdAt updatedAt")
uom = {n: cid("uom") for n in ["kg", "litre", "piece", "packet", "box", "dozen", "set"]}
for n, i in uom.items():
    UOM_ROWS.append([i, ORG, n, True, BUILT, BUILT])
GST_ROWS = table("GstRate", "id orgId rate isActive createdAt updatedAt")
gst = {r: cid("gst") for r in [0.0, 5.0, 12.0, 18.0, 28.0]}
for r, i in gst.items():
    GST_ROWS.append([i, ORG, r, True, BUILT, BUILT])
IT_ROWS = table("Item", "id orgId name quantity capacity uomId mrp gstId isActive createdAt updatedAt")
ITEMS = [("Rice (Sona Masoori)", "kg", 62, 5, 2000), ("Toor Dal", "kg", 130, 5, 400), ("Moong Dal", "kg", 118, 5, 200), ("Wheat Atta", "kg", 44, 5, 800),
         ("Refined Sunflower Oil", "litre", 145, 5, 400), ("Milk (toned)", "litre", 46, 0, 300), ("Curd", "kg", 60, 0, 120), ("Eggs", "dozen", 78, 0, 150),
         ("Onion", "kg", 38, 0, 500), ("Potato", "kg", 32, 0, 500), ("Tomato", "kg", 30, 0, 300), ("Paneer", "kg", 360, 5, 60), ("Sugar", "kg", 44, 5, 250),
         ("Tea Powder", "kg", 480, 5, 40), ("Coffee Powder", "kg", 620, 5, 30), ("Sambar Powder", "kg", 280, 5, 40), ("Salt", "kg", 22, 0, 100), ("LPG Cylinder (commercial)", "piece", 1780, 18, 24),
         ("Phenyl", "litre", 90, 18, 120), ("Floor Cleaner", "litre", 160, 18, 100), ("Toilet Cleaner", "litre", 180, 18, 80), ("Garbage Bags (large)", "packet", 120, 18, 150),
         ("Broom", "piece", 90, 5, 60), ("Mop Refill", "piece", 140, 18, 60), ("Hand Wash Liquid", "litre", 210, 18, 60), ("LED Bulb 9W", "piece", 110, 12, 150),
         ("LED Tube Light 20W", "piece", 320, 12, 120), ("Ceiling Fan Capacitor", "piece", 85, 18, 80), ("Switch (6A)", "piece", 45, 18, 150), ("Extension Board", "piece", 390, 18, 30),
         ("Tap (brass)", "piece", 460, 18, 40), ("PVC Pipe 1 inch", "piece", 240, 18, 50), ("Mattress (single)", "piece", 3200, 12, 60), ("Pillow", "piece", 380, 12, 120),
         ("Bedsheet", "piece", 420, 5, 300), ("Blanket", "piece", 880, 5, 150), ("Bucket (20L)", "piece", 220, 18, 150), ("Mug", "piece", 60, 18, 150), ("Study Chair", "piece", 2400, 18, 40),
         ("Cupboard Lock", "piece", 290, 18, 80), ("Register Book", "piece", 150, 12, 50), ("A4 Paper", "box", 1450, 12, 20), ("Mosquito Repellent Refill", "piece", 75, 18, 300)]
items = []
for n, u, mrp, g, capq in ITEMS:
    i = cid("item")
    q = float(round(capq * rng.uniform(0.15, 0.9)))
    items.append({"id": i, "name": n, "mrp": mrp, "gst": g, "cap": capq})
    IT_ROWS.append([i, ORG, n, q, float(capq), uom[u], float(mrp), gst[float(g)], True, BUILT, datetime(2026, 9, rng.randint(1, 25), 10, 0)])
KITCHEN = [x for x in items[:18]]
HOUSE = [x for x in items[18:25]]
MAINT = [x for x in items[25:]]

PO_ROWS = table("PurchaseOrder", "id orgId poNo hostelId supplierId poDate totalAmount status remarks createdById isActive createdAt updatedAt")
POI_ROWS = table("PurchaseOrderItem", "id orgId poId itemId quantity unitPrice gstAmount total createdAt")
GRN_ROWS = table("Grn", "id orgId grnNo hostelId supplierId grnDate totalAmount receivedById createdAt updatedAt")
GI_ROWS = table("GrnItem", "id orgId grnId itemId quantity unitPrice gstAmount total createdAt")
po_n = grn_n = 0
for d in days(date(2026, 3, 2), TODAY):
    if d.weekday() not in (0, 3):  # orders twice a week
        continue
    for h in rng.sample(hostels, 2):
        po_n += 1
        sup = pick(suppliers)
        group = pick([KITCHEN, KITCHEN, HOUSE, MAINT])
        lines = rng.sample(group, rng.randint(2, 6))
        pid = cid("po")
        when = ist(d, 11, rng.randint(0, 59))
        status = "RECEIVED" if d < TODAY - timedelta(days=6) else pick(["PENDING", "CONFIRMED", "RECEIVED"], [35, 40, 25])
        if chance(0.04):
            status = "CANCELLED"
        tot = 0.0
        rows = []
        for it in lines:
            q = float(max(1, round(it["cap"] * rng.uniform(0.05, 0.3))))
            up = money(it["mrp"] * rng.uniform(0.82, 0.97))
            g = money(q * up * it["gst"] / 100)
            t = money(q * up + g)
            tot += t
            rows.append((it, q, up, g, t))
            POI_ROWS.append([cid("poitem"), ORG, pid, it["id"], q, up, g, t, when])
        PO_ROWS.append([pid, ORG, f"KIT/PO/{d.year}/{po_n:04d}", h["id"], sup, when, money(tot), status, "Cancelled — supplier out of stock" if status == "CANCELLED" else None,
                        staff["store"]["id"], status != "CANCELLED", when, when + timedelta(days=rng.randint(0, 5))])
        if status == "RECEIVED":
            grn_n += 1
            gid = cid("grn")
            gwhen = when + timedelta(days=rng.randint(1, 4), hours=rng.randint(0, 5))
            GRN_ROWS.append([gid, ORG, f"KIT/GRN/{d.year}/{grn_n:04d}", h["id"], sup, gwhen, money(tot), staff["store"]["id"], gwhen, gwhen])
            for it, q, up, g, t in rows:
                GI_ROWS.append([cid("grnitem"), ORG, gid, it["id"], q, up, g, t, gwhen])

IR_ROWS = table("IssueRegister", "id orgId hostelId itemId issuedTo quantity issueDate issuedById remarks createdAt")
for d in days(date(2026, 4, 1), TODAY - timedelta(days=1)):
    for h in hostels:
        for _ in range(rng.randint(0, 2)):
            grp = pick([KITCHEN, HOUSE, MAINT], [55, 30, 15])
            it = pick(grp)
            to = "Mess kitchen" if grp is KITCHEN else ("Housekeeping team" if grp is HOUSE else f"Room {pick(h['rooms'])['number']}")
            when = ist(d, rng.randint(7, 18), rng.randint(0, 59))
            IR_ROWS.append([cid("issue"), ORG, h["id"], it["id"], to, float(max(1, round(it["cap"] * rng.uniform(0.01, 0.06)))), when, staff["store"]["id"],
                            None if chance(0.7) else pick(["Weekly requirement", "Replacement for damaged item", "Urgent request from warden"]), when])
SC_ROWS = table("ItemScrap", "id orgId hostelId itemId quantity scrapDate reason scrappedById createdAt")
for _ in range(46):
    it = pick(MAINT + HOUSE[:2])
    when = jitter(date(2026, 3, 1) + timedelta(days=rng.randint(0, 200)))
    SC_ROWS.append([cid("scrap"), ORG, pick(hostels)["id"], it["id"], float(rng.randint(1, 6)), when,
                    pick(["Damaged beyond repair", "Fused", "Torn / worn out", "Rusted", "Water damage during monsoon"]), staff["store"]["id"], when])

# --------------------------------------------------------------------------------------------
# mess: charges, menu, bills, payments, meal attendance, meal plans
# --------------------------------------------------------------------------------------------
FC_ROWS = table("FoodCharge", "id orgId hostelId foodType price isActive createdAt updatedAt")
PRICES = {"BREAKFAST": 40.0, "LUNCH": 65.0, "SNACK": 20.0, "DINNER": 65.0}
for h in hostels:
    for ftp, p in PRICES.items():
        FC_ROWS.append([cid("foodcharge"), ORG, h["id"], ftp, p + (5.0 if h["code"] == "NMD" else 0.0), True, BUILT, datetime(2026, 4, 1, 4, 0)])

MM_ROWS = table("MessMenu", "id orgId hostelId dayOfWeek mealType menuItems isActive createdAt updatedAt")
MENU = {
    "MONDAY": ["Idli, Sambar, Coconut Chutney, Tea/Coffee", "Rice, Dal Tadka, Beans Palya, Rasam, Curd, Papad", "Masala Puri, Tea", "Chapati, Paneer Butter Masala, Jeera Rice, Salad"],
    "TUESDAY": ["Poha, Boiled Egg / Banana, Coffee", "Bisi Bele Bath, Raita, Chips, Rice, Rasam", "Samosa, Tea", "Phulka, Chana Masala, Veg Pulao, Curd"],
    "WEDNESDAY": ["Masala Dosa, Chutney, Sambar, Tea/Coffee", "Rice, Sambar, Cabbage Poriyal, Curd, Pickle", "Bajji, Tea", "Chapati, Egg Curry / Veg Kurma, Rice, Dal"],
    "THURSDAY": ["Upma, Kesari Bath, Coffee", "Rice, Rajma, Aloo Gobi, Rasam, Buttermilk", "Biscuits, Tea", "Paratha, Dal Makhani, Rice, Salad"],
    "FRIDAY": ["Aloo Paratha, Curd, Tea", "Veg Biryani, Raita, Mirchi ka Salan, Rice, Rasam", "Pakoda, Tea", "Chapati, Mixed Veg, Rice, Dal Fry, Gulab Jamun"],
    "SATURDAY": ["Pongal, Vada, Chutney, Coffee", "Rice, Sambar, Palya, Curd, Payasam", "Maggi, Tea", "Fried Rice, Gobi Manchurian, Soup"],
    "SUNDAY": ["Chole Bhature, Tea", "Chicken Biryani / Paneer Biryani, Raita, Onion Salad", "Cake, Tea", "Chapati, Aloo Matar, Rice, Rasam, Ice Cream"],
}
for h in hostels:
    for dow, meals in MENU.items():
        for mt, m in zip(["BREAKFAST", "LUNCH", "SNACK", "DINNER"], meals):
            MM_ROWS.append([cid("menu"), ORG, h["id"], dow, mt, m, True, BUILT, datetime(2026, 6, 28, 6, 0)])

MB_ROWS = table("MessBill", "id orgId hostelId billMonth billYear billDate generatedById createdAt updatedAt")
MBI_ROWS = table("MessBillItem", "id orgId messBillId studentId breakfastDays lunchDays dinnerDays snackDays breakfastAmt lunchAmt dinnerAmt snackAmt totalAmt createdAt")
MBP_ROWS = table("MessBillPayment", "id orgId messBillItemId paymentDate amountPaid mop utrNo collectedById createdAt")
for h in hostels:
    price = {k: v + (5.0 if h["code"] == "NMD" else 0.0) for k, v in PRICES.items()}
    for m in range(3, 9):  # March–August 2026 billed; September bill runs on 1 Oct
        bd = datetime(2026, m + 1, 1, 5, 0)
        mb = cid("messbill")
        MB_ROWS.append([mb, ORG, h["id"], m, 2026, bd, staff["mess"]["id"], bd, bd])
        dim = (date(2026, m + 1, 1) - date(2026, m, 1)).days
        for s in [x for x in live if x["hostel"] is h and x["admit"] < date(2026, m, 20)]:
            if m in (5, 6) and chance(0.55):  # summer vacation — many went home
                continue
            base = dim - (rng.randint(8, 25) if m in (5, 6) else rng.randint(0, 6))
            bdays, ldays, ddays, sdays = (max(0, base - rng.randint(0, 8)), max(0, base - rng.randint(2, 12)), max(0, base - rng.randint(0, 5)), max(0, base - rng.randint(5, 18)))
            amts = [bdays * price["BREAKFAST"], ldays * price["LUNCH"], ddays * price["DINNER"], sdays * price["SNACK"]]
            it = cid("messitem")
            tot = float(sum(amts))
            MBI_ROWS.append([it, ORG, mb, s["id"], bdays, ldays, ddays, sdays, *[float(a) for a in amts], tot, bd])
            p = 0.99 if m < 8 else 0.72
            if chance(p):
                pd = bd + timedelta(days=rng.randint(1, 20), hours=rng.randint(0, 10))
                pd = min(pd, NOW - timedelta(hours=2))
                mop = pick(["ONLINE", "CASH", "NEFT"], [75, 15, 10])
                MBP_ROWS.append([cid("messpay"), ORG, it, pd, tot, mop, None if mop == "CASH" else f"UTR{rng.randint(10**11, 10**12 - 1)}", staff["mess"]["id"], pd])

MA_ROWS = table("MessAttendance", "id orgId hostelId studentId attendanceDate mealType status isActive createdAt updatedAt")
MP_ROWS = table("MealPlan", "id studentId hostelId date breakfast lunch dinner snack confirmed lockedAt createdAt updatedAt")
for d in days(TODAY - timedelta(days=6), TODAY + timedelta(days=3)):
    for s in live:
        if d < s["admit"] or d in on_leave.get(s["id"], ()):
            continue
        plan = {k: chance(p) for k, p in (("breakfast", 0.82), ("lunch", 0.7), ("dinner", 0.93), ("snack", 0.55))}
        past = d < TODAY
        confirmed = past or (d == TODAY) or chance(0.45 if d == TODAY + timedelta(days=1) else 0.15)
        c_at = ist(d - timedelta(days=1), rng.randint(18, 22), rng.randint(0, 59))
        MP_ROWS.append([cid("mealplan"), s["id"], s["hostel"]["id"], datetime.combine(d, datetime.min.time()), plan["breakfast"], plan["lunch"], plan["dinner"], plan["snack"],
                        confirmed, ist(d, 6, 0) if past else None, c_at, c_at + timedelta(minutes=rng.randint(0, 90))])
        if past:
            for meal, hh in (("BREAKFAST", 8), ("LUNCH", 13), ("DINNER", 20)):
                if plan[meal.lower()]:
                    t = ist(d, hh, rng.randint(0, 50))
                    MA_ROWS.append([cid("messatt"), ORG, s["hostel"]["id"], s["id"], datetime.combine(d, datetime.min.time()), meal, "PRESENT" if chance(0.94) else "ABSENT", True, t, t])

SA_ROWS = table("StaffAttendance", "id orgId hostelId staffId attendanceDate punchIn punchOut status createdById createdAt")
for u in list(staff.values()) + wardens:
    for d in days(TODAY - timedelta(days=59), TODAY):
        if d.weekday() == 6 and u["role"] == "STAFF" and chance(0.8):
            continue
        st = "PRESENT" if chance(0.93) else pick(["LEAVE", "ABSENT"], [70, 30])
        pin = f"{rng.randint(8, 9):02d}:{rng.randint(0, 59):02d}" if st == "PRESENT" else None
        pout = None if st != "PRESENT" or d == TODAY else f"{rng.randint(17, 19):02d}:{rng.randint(0, 59):02d}"
        hid = (u["hostel"] or pick(hostels))["id"]
        SA_ROWS.append([cid("staffatt"), ORG, hid, u["id"], datetime.combine(d, datetime.min.time()), pin, pout, st, admin["id"], ist(d, 9, rng.randint(0, 59))])

# --------------------------------------------------------------------------------------------
# laundry, maintenance appointments, holidays, announcements
# --------------------------------------------------------------------------------------------
WM_ROWS = table("WashingMachine", "id orgId hostelId name location status isActive createdAt updatedAt")
LB_ROWS = table("LaundryBooking", "id orgId machineId studentId date slot status createdAt updatedAt")
SLOTS = ["06:00-07:00", "07:00-08:00", "08:00-09:00", "09:00-10:00", "17:00-18:00", "18:00-19:00", "19:00-20:00", "20:00-21:00"]
for h in hostels:
    mine = [s for s in live if s["hostel"] is h]
    for i in range(1, 5):
        mid = cid("machine")
        status = "MAINTENANCE" if (h["code"], i) == ("KVR", 3) else "AVAILABLE"
        WM_ROWS.append([mid, ORG, h["id"], f"{h['code']}-WM{i}", f"Block {'A' if i <= 2 else 'B'} ground floor laundry room", status, True, BUILT, BUILT])
        for d in days(TODAY - timedelta(days=13), TODAY + timedelta(days=3)):
            if status == "MAINTENANCE" and d >= TODAY - timedelta(days=4):
                continue
            for sl in SLOTS:
                if chance(0.62 if d.weekday() >= 5 else 0.45):
                    s = pick(mine)
                    if d < TODAY:
                        st = pick(["COMPLETED", "NO_SHOW", "CANCELLED"], [86, 8, 6])
                    else:
                        st = "BOOKED" if not (d == TODAY and int(sl[:2]) < 15) else "COMPLETED"
                    c_at = ist(d - timedelta(days=rng.randint(0, 2)), rng.randint(7, 22), rng.randint(0, 59))
                    LB_ROWS.append([cid("laundry"), ORG, mid, s["id"], datetime.combine(d, datetime.min.time()), sl, st, c_at, c_at])

SV_ROWS = table("ServiceAppointment", "id orgId hostelId serviceType workerName contact date slot status notes createdById createdAt updatedAt")
WORKERS = {"ELECTRICIAN": ["Suresh Kumar", "Vijay Electricals (contract)"], "PLUMBER": ["Ravi Naik", "Kaveri Plumbing Works"], "CLEANER": ["Manjula Devi", "Sparkle Facility Services"],
           "CARPENTER": ["Anand Acharya"], "PEST_CONTROL": ["PestFree Solutions", "HiCare Services"], "OTHER": ["Blue Star AC Service", "Aquaguard RO Service"]}
for d in days(date(2026, 6, 1), TODAY + timedelta(days=14)):
    for _ in range(rng.choices([0, 1, 2], [40, 45, 15])[0]):
        stype = pick(list(WORKERS), [25, 22, 18, 12, 10, 13])
        st = pick(["COMPLETED", "CANCELLED"], [92, 8]) if d < TODAY else pick(["SCHEDULED", "CONFIRMED"], [55, 45])
        h = pick(hostels)
        note = {"PEST_CONTROL": "Quarterly pest control — all floors", "OTHER": "Water purifier servicing, mess and floor dispensers",
                "CLEANER": "Deep cleaning of common washrooms", "ELECTRICIAN": f"Wiring check, room {pick(h['rooms'])['number']}",
                "PLUMBER": f"Leak repair near room {pick(h['rooms'])['number']}", "CARPENTER": "Repair study chairs and cupboard locks"}[stype]
        c_at = ist(d - timedelta(days=rng.randint(1, 6)), rng.randint(9, 17), rng.randint(0, 59))
        SV_ROWS.append([cid("service"), ORG, h["id"], stype, pick(WORKERS[stype]), phone(), datetime.combine(d, datetime.min.time()),
                        pick(["08:00-10:00", "10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00"]), st, note, WARDEN_OF[h["code"]]["id"], c_at, c_at])

HO_ROWS = table("Holiday", "id orgId date name createdById createdAt")
for d, n in [("2026-01-15", "Makara Sankranti"), ("2026-01-26", "Republic Day"), ("2026-03-04", "Maha Shivaratri"), ("2026-03-19", "Ugadi"), ("2026-03-31", "Ramzan (Id-ul-Fitr)"),
             ("2026-04-03", "Good Friday"), ("2026-04-14", "Dr. Ambedkar Jayanti"), ("2026-05-01", "Labour Day"), ("2026-06-07", "Bakrid"), ("2026-08-15", "Independence Day"),
             ("2026-08-26", "Varamahalakshmi Vrata"), ("2026-09-14", "Ganesh Chaturthi"), ("2026-10-02", "Gandhi Jayanti"), ("2026-10-19", "Maha Navami"), ("2026-10-20", "Vijayadashami"),
             ("2026-11-01", "Kannada Rajyotsava"), ("2026-11-09", "Deepavali"), ("2026-11-27", "Kanakadasa Jayanti"), ("2026-12-25", "Christmas")]:
    HO_ROWS.append([cid("holiday"), ORG, datetime.fromisoformat(d), n, admin["id"], datetime(2025, 12, 20, 6, 0)])

AN_ROWS = table("Announcement", "id orgId title body audience hostelId priority createdById createdAt updatedAt")
NOTICES = [
    ("Water supply interruption", "Water supply will be off on {d} from 10 AM to 2 PM for tank cleaning. Please store water in advance.", "ALL", "IMPORTANT"),
    ("Mess committee meeting", "Mess committee meeting on {d} at 6 PM in the dining hall. Two representatives per floor please attend.", "STUDENTS", "NORMAL"),
    ("Fee due reminder", "Hostel fee for the Odd 2026 semester was due on 15 July. Students with pending dues must clear them to avoid a late fine.", "STUDENTS", "URGENT"),
    ("Wi-Fi maintenance", "Wi-Fi will be down on {d} between 1 AM and 5 AM for access-point upgrades.", "ALL", "NORMAL"),
    ("Pest control schedule", "Pest control on {d}. Keep food items sealed and cupboards closed.", "ALL", "NORMAL"),
    ("Fire drill", "A fire drill will be held on {d} at 7 AM. Assemble at the football ground.", "ALL", "IMPORTANT"),
    ("Curfew reminder", "Gates close at 10:30 PM. Late entries are logged and reported to parents.", "STUDENTS", "IMPORTANT"),
    ("Warden meeting", "Weekly warden review on {d}, 11 AM, admin block.", "WARDENS", "NORMAL"),
    ("Staff duty roster", "Revised duty roster for festival week is on the notice board.", "STAFF", "NORMAL"),
    ("Ganesh Chaturthi celebration", "Cultural evening on {d} at 6:30 PM in the courtyard. Special dinner menu.", "STUDENTS", "NORMAL"),
    ("Room inspection", "Routine room inspection on {d}. Remove unauthorised appliances (kettles, heaters).", "STUDENTS", "IMPORTANT"),
    ("Laundry machine out of order", "KVR-WM3 is under maintenance. Please book another machine.", "STUDENTS", "NORMAL"),
]
for i in range(52):
    t, b, aud, pr = NOTICES[i % len(NOTICES)]
    d = TODAY - timedelta(days=int(180 * (1 - i / 52)))
    h = pick(hostels + [None, None])
    when = ist(d - timedelta(days=2), rng.randint(9, 18), rng.randint(0, 59))
    AN_ROWS.append([cid("notice"), ORG, t, b.format(d=d.strftime("%d %b %Y")), aud, h["id"] if h else None, pr, (WARDEN_OF[h["code"]] if h else admin)["id"], when, when])

# --------------------------------------------------------------------------------------------
# notifications & audit trail
# --------------------------------------------------------------------------------------------
N_ROWS = table("Notification", "id userId title message type link isRead createdAt")
for u in users:
    n = 25 if u["role"] in ("ADMIN", "WARDEN") else (12 if u["role"] == "STAFF" else 6)
    for _ in range(n):
        when = NOW - timedelta(hours=rng.randint(1, 24 * 45))
        kind = pick(["complaint", "payment", "leave", "visitor", "system", "stock"])
        title, msg, typ, link = {
            "complaint": ("New complaint assigned", f"'{pick(['Fan not working', 'Wi-Fi drops every evening', 'Tap leaking in bathroom', 'Room not cleaned'])}' needs attention.", "WARNING", "/complaints"),
            "payment": ("Payment received", f"₹{pick([4200, 29000, 24750, 36000]):,} received via UPI.", "SUCCESS", "/fees"),
            "leave": ("Leave request pending", "A student has requested leave for the weekend.", "INFO", "/leave"),
            "visitor": ("Visitor at the gate", "A parent is waiting at the front desk.", "INFO", "/visitors"),
            "system": ("Nightly backup completed", "All hostel data was backed up successfully.", "SUCCESS", None),
            "stock": ("Low stock alert", f"{pick(items)['name']} is below 20% of capacity.", "WARNING", "/inventory"),
        }[kind]
        if u["role"] == "STUDENT":
            title, msg, typ, link = pick([("Fee reminder", "Your Odd 2026 hostel fee is due.", "WARNING", "/fees"), ("Leave approved", "Your leave request was approved.", "SUCCESS", "/leave"),
                                          ("Laundry slot tomorrow", "Your washing machine booking is tomorrow 07:00-08:00.", "INFO", "/laundry"), ("Complaint resolved", "Your complaint has been resolved.", "SUCCESS", "/complaints")])
        N_ROWS.append([cid("notif"), u["id"], title, msg, typ, link, when < NOW - timedelta(days=3) or chance(0.4), when])
N_ROWS.append([cid("notif"), admin["id"], "Bed occupancy exceeds capacity", "3 rooms have more occupants than their capacity (A-204 Ganga, B-307 Yamuna, A-409 Kaveri).", "EMERGENCY", "/hostels", False, NOW - timedelta(days=3)])

AU_ROWS = table("AuditLog", "id userId action entity entityId changes ip userAgent createdAt")
UAS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1", "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile"]
for row in A_ROWS[-1200:]:
    AU_ROWS.append([cid("audit"), pick([w["id"] for w in wardens] + [admin["id"]]), "CREATE", "Allocation", row[0], json.dumps({"bedId": row[2], "studentId": row[1]}), f"10.20.{rng.randint(0, 9)}.{rng.randint(2, 250)}", pick(UAS), row[7]])
for row in rng.sample(P_ROWS, 1500):
    if row[4] == "PAID":
        AU_ROWS.append([cid("audit"), staff["accounts"]["id"], "UPDATE", "Payment", row[0], json.dumps({"status": ["PENDING", "PAID"], "method": row[5]}), f"10.20.1.{rng.randint(2, 250)}", UAS[0], row[11]])
for row in rng.sample(C_ROWS, 700):
    AU_ROWS.append([cid("audit"), row[7] or admin["id"], "UPDATE", "Complaint", row[0], json.dumps({"status": ["OPEN", row[6]]}), f"10.20.3.{rng.randint(2, 250)}", pick(UAS), row[11]])
for u in users[:20]:
    for _ in range(15):
        AU_ROWS.append([cid("audit"), u["id"], "LOGIN", "User", u["id"], None, f"10.20.{rng.randint(0, 9)}.{rng.randint(2, 250)}", pick(UAS), NOW - timedelta(hours=rng.randint(1, 24 * 30))])
AU_ROWS.sort(key=lambda r: r[8])

table("PushSubscription", "id userId endpoint p256dh auth userAgent createdAt")  # stays empty: needs real browsers

# --------------------------------------------------------------------------------------------
# write SQL
# --------------------------------------------------------------------------------------------
LOAD_ORDER = ["Organization", "User", "Hostel", "Block", "Floor", "Room", "Bed", "Student", "Allocation", "Payment", "Complaint", "Attendance",
              "Visitor", "Notification", "AuditLog", "FoodCharge", "FeeType", "SubFeeType", "FeeStructure", "Challan", "ChallanItem", "Receipt", "Refund",
              "Supplier", "Uom", "GstRate", "Item", "Grn", "GrnItem", "IssueRegister", "ItemScrap", "PurchaseOrder", "PurchaseOrderItem", "MessBill",
              "MessBillItem", "MessBillPayment", "MessMenu", "MessAttendance", "StudentDailyAttendance", "StaffAttendance", "MealPlan", "Announcement",
              "LeaveRequest", "WashingMachine", "LaundryBooking", "PushSubscription", "ServiceAppointment", "Holiday"]
assert sorted(LOAD_ORDER) == sorted(TABLES), set(LOAD_ORDER) ^ set(TABLES)


def main() -> None:
    total = sum(len(TABLES[t][1]) for t in LOAD_ORDER)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        f.write("-- Hostel OS — full production database (schema + data). Generated by demo/hostel_os/generate.py; do not edit by hand.\n")
        f.write(f"-- {len(LOAD_ORDER)} tables, {total:,} rows. Load into an EMPTY database:\n")
        f.write("--   psql -U postgres -d hostel -v ON_ERROR_STOP=1 -f demo/hostel_os/hostel_os.sql\n\n")
        f.write("SET client_encoding = 'UTF8';\nSET client_min_messages = warning;\nBEGIN;\n\n")
        # Prisma's bookkeeping table, so `prisma migrate deploy` sees both migrations as applied
        f.write('CREATE TABLE "_prisma_migrations" (\n    "id" VARCHAR(36) PRIMARY KEY NOT NULL,\n    "checksum" VARCHAR(64) NOT NULL,\n    "finished_at" TIMESTAMPTZ,\n'
                '    "migration_name" VARCHAR(255) NOT NULL,\n    "logs" TEXT,\n    "rolled_back_at" TIMESTAMPTZ,\n    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),\n'
                '    "applied_steps_count" INTEGER NOT NULL DEFAULT 0\n);\n\n')
        for i, mig in enumerate(MIGRATIONS):
            raw = mig.read_bytes()
            f.write(f"-- ===== Prisma migration {mig.parent.name} =====\n")
            f.write(raw.decode("utf-8").replace("\r\n", "\n"))
            f.write("\n")
            applied = datetime(2026, 6, 7 if i == 0 else 9, 10, 0, 0)
            f.write(f"INSERT INTO \"_prisma_migrations\" VALUES ('{hashlib.md5(mig.parent.name.encode()).hexdigest()[:8]}-0000-4000-8000-{hashlib.md5(raw).hexdigest()[:12]}', "
                    f"'{hashlib.sha256(raw).hexdigest()}', '{applied.isoformat()}+00', '{mig.parent.name}', NULL, NULL, '{applied.isoformat()}+00', 1);\n\n")
        for t in LOAD_ORDER:
            cols, rows = TABLES[t]
            f.write(f'COPY "{t}" ({", ".join(chr(34) + c + chr(34) for c in cols)}) FROM stdin;\n')
            for r in rows:
                assert len(r) == len(cols), (t, r)
                f.write("\t".join(esc(v) for v in r) + "\n")
            f.write("\\.\n\n")
        f.write("COMMIT;\nANALYZE;\n")
    print(f"wrote {OUT.relative_to(HERE.parent.parent)}  ({OUT.stat().st_size / 1e6:.1f} MB, {total:,} rows)")
    for t in LOAD_ORDER:
        print(f"  {t:<24}{len(TABLES[t][1]):>8,}")


if __name__ == "__main__":
    main()
