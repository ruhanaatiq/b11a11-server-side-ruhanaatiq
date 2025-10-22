const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://car-rental-169b3.web.app"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json());

let client;
let cars;
let bookings;
let indexesEnsured = false;

async function connectDB() {
  if (client) return;
  const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.neq8pcg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  const db = client.db("carDB");
  cars = db.collection("rental");
  bookings = db.collection("bookings");
    if (!indexesEnsured) {
    await bookings.createIndex({ carId: 1, startDate: 1, endDate: 1 }); // fast overlap
    await bookings.createIndex({ ownerEmail: 1, createdAt: -1 });
    indexesEnsured = true;
  }

}

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send("Unauthorized");
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send("Forbidden");
    req.user = decoded;
    next();
  });
};

app.post("/api/jwt", (req, res) => {
  const token = jwt.sign({ email: req.body.email }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.send({ token });
});

app.get("/api/cars", async (req, res) => {
  await connectDB();
  const result = await cars.find().toArray();
  res.send(result);
});

app.post("/api/cars", verifyJWT, async (req, res) => {
  await connectDB();
  const car = { ...req.body, dateAdded: new Date(), bookingCount: 0 };
  const result = await cars.insertOne(car);
  res.send(result);
});

app.get("/api/cars/:id", async (req, res) => {
  await connectDB();
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
  const car = await cars.findOne({ _id: new ObjectId(id) });
  res.send(car);
});

app.put("/api/cars/:id", verifyJWT, async (req, res) => {
  await connectDB();
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
  const car = await cars.findOne({ _id: new ObjectId(id) });
  if (car.ownerEmail !== req.user.email) return res.status(403).send("Unauthorized");
  const result = await cars.updateOne({ _id: new ObjectId(id) }, { $set: req.body });
  res.send(result);
});

app.delete("/api/cars/:id", verifyJWT, async (req, res) => {
  await connectDB();
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
  const car = await cars.findOne({ _id: new ObjectId(id) });
  if (car.ownerEmail !== req.user.email) return res.status(403).send("Unauthorized");
  const result = await cars.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.get("/api/bookings", verifyJWT, async (req, res) => {
  await connectDB();
  const email = req.query.email;
  if (email !== req.user.email) return res.status(403).send("Forbidden");

  const result = await bookings.aggregate([
    { $match: { ownerEmail: email } },
    {
      $lookup: {
        from: "rental",
        localField: "carId",
        foreignField: "_id",
        as: "carDetails"
      }
    },
    { $unwind: "$carDetails" },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 1,
        startDate: 1,
        endDate: 1,
        totalPrice: 1,
        bookingStatus: 1,
        createdAt: 1,
        carModel: "$carDetails.model",
        carImage: { $arrayElemAt: ["$carDetails.images", 0] },
      }
    }
  ]).toArray();

  res.send(result);
});

app.get("/api/bookings/car/:carId", async (req, res) => {
  await connectDB();
  const { carId } = req.params;
  const { from, to } = req.query;

  if (!ObjectId.isValid(carId)) return res.status(400).send("Invalid ID");

  const q = {
    carId: new ObjectId(carId),
    bookingStatus: { $in: ["pending", "confirmed"] },
  };

  if (from || to) {
    const fromD = from ? new Date(from) : new Date("1970-01-01");
    const toD   = to   ? new Date(to)   : new Date("2999-12-31");
    q.startDate = { $lte: toD };
    q.endDate   = { $gte: fromD };
  }

  const ranges = await bookings
    .find(q, { projection: { _id: 0, startDate: 1, endDate: 1 } })
    .sort({ startDate: 1 })
    .toArray();

  res.send({ bookings: ranges });
});
app.get("/api/locations", async (req, res) => {
  res.send({
    branches: [
      { code: "DAC", name: "Dhaka Airport" },
      { code: "CTG", name: "Chattogram" },
      { code: "SYL", name: "Sylhet" },
    ],
  });
});

/* ---------- Booking Calendar: availability boolean ---------- */
app.get("/api/cars/:id/availability", async (req, res) => {
  await connectDB();
  const { id } = req.params;
  const { from, to } = req.query;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
  if (!from || !to) return res.status(400).send("from & to are required (YYYY-MM-DD)");

  const start = new Date(from);
  const end   = new Date(to);

  const overlap = await bookings.findOne({
    carId: new ObjectId(id),
    bookingStatus: { $in: ["pending", "confirmed"] },
    startDate: { $lte: end },
    endDate:   { $gte: start },
  });

  res.send({ available: !overlap });
});
/*-------location api-------*/
app.get("/api/search", async (req, res) => {
  await connectDB();

  const { pickup, dropoff, from, to, promo } = req.query;
  if (!from || !to) return res.status(400).send({ error: "from & to required (ISO datetime)" });

  const start = new Date(from);
  const end   = new Date(to);
  if (isNaN(start) || isNaN(end) || end <= start) {
    return res.status(400).send({ error: "Invalid date range" });
  }

  // cars must have branch/location set when created/updated
  const carMatch = {};
  if (pickup) carMatch.branch = pickup;   // filter by pickup branch

  // Find cars that are NOT overlapped by existing bookings
  const overlappedCarIds = await bookings.distinct("carId", {
    bookingStatus: { $in: ["pending", "confirmed"] },
    startDate: { $lte: end },
    endDate:   { $gte: start },
  });

  const q = { ...carMatch, _id: { $nin: overlappedCarIds } };

  const items = await cars.find(q)
    .project({ model: 1, images: 1, dailyPrice: 1, branch: 1 })
    .toArray();

  // simple total price calc (non-inclusive); adjust +1 if you want inclusive
  const dayMs = 86400000;
  const days = Math.max(1, Math.ceil((end - start) / dayMs));
  const promoPct = promo ? ({ SAVE10: 10, WEEKEND5: 5 }[promo.toUpperCase()] || 0) : 0;

  const result = items.map(c => {
    const base = (c.dailyPrice || 0) * days;
    const finalPrice = Math.ceil(base * (1 - promoPct / 100));
    return { ...c, priceBeforeDeals: base, finalPrice };
  });

  res.send({ items: result, days, promoApplied: promoPct });
});

/* ---------- Create booking (fixed overlap & price calc) ---------- */
app.post("/api/bookings", verifyJWT, async (req, res) => {
  await connectDB();
  const { carId, startDate, endDate } = req.body;
  const userEmail = req.user.email;

  if (!ObjectId.isValid(carId)) return res.status(400).send("Invalid carId");

  const car = await cars.findOne({ _id: new ObjectId(carId) });
  if (!car) return res.status(404).send({ error: "Car not found" });

  const start = new Date(startDate);
  const end   = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return res.status(400).send({ error: "Invalid dates" });
  if (end < start) return res.status(400).send({ error: "End date must be after start date" });

  // canonical overlap: existing.start <= end && existing.end >= start
  const overlap = await bookings.findOne({
    carId: new ObjectId(carId),
    bookingStatus: { $in: ["pending", "confirmed"] },
    startDate: { $lte: end },
    endDate:   { $gte: start },
  });
  if (overlap) return res.status(409).send({ error: "Overlapping booking" });

  const dayMs = 1000 * 60 * 60 * 24;
  const totalDays = Math.max(1, Math.ceil((end - start) / dayMs)); // change to +1 for inclusive
  const dailyRate = Number(car.dailyPrice ?? car.price ?? 0);
  const totalPrice = totalDays * dailyRate;

  const booking = {
    carId: new ObjectId(carId),
    ownerEmail: userEmail,
    carModel: car.model,
    carImage: Array.isArray(car.images) ? (car.images?.[0] || "") : (car.image || ""),
    startDate: start,
    endDate: end,
    totalPrice,
    bookingStatus: "pending",
    createdAt: new Date(),
  };

  const result = await bookings.insertOne(booking);
  await cars.updateOne({ _id: new ObjectId(carId) }, { $inc: { bookingCount: 1 } });

  res.send({ message: "Booking created", bookingId: result.insertedId });
});

/* ---------- Confirm / Modify ---------- */
app.put("/api/bookings/confirm/:id", verifyJWT, async (req, res) => {
  await connectDB();
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
  const booking = await bookings.findOne({ _id: new ObjectId(id) });
  if (!booking || booking.ownerEmail !== req.user.email) return res.status(403).send("Unauthorized");
  const result = await bookings.updateOne(
    { _id: new ObjectId(id) },
    { $set: { bookingStatus: "confirmed" } }
  );
  res.send(result);
});

app.put("/api/bookings/modify/:id", verifyJWT, async (req, res) => {
  await connectDB();
  const { startDate, endDate } = req.body;
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

  const existing = await bookings.findOne({ _id: new ObjectId(id) });
  if (!existing || existing.ownerEmail !== req.user.email) return res.status(403).send("Unauthorized");

  const newStart = new Date(startDate);
  const newEnd   = new Date(endDate);
  if (newEnd < newStart) return res.status(400).send("Invalid range");

  // recompute price using original daily rate
  const oldDays = Math.max(1, Math.ceil((existing.endDate - existing.startDate) / (1000*60*60*24)));
  const dailyRate = oldDays ? (existing.totalPrice / oldDays) : 0;
  const newDays = Math.max(1, Math.ceil((newEnd - newStart) / (1000*60*60*24)));

  const result = await bookings.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        startDate: newStart,
        endDate: newEnd,
        totalPrice: newDays * dailyRate,
      },
    }
  );

  res.send(result);
});
const handler = (req, res) => {
  app(req, res);
};

export default handler;
