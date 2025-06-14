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

app.post("/api/bookings", verifyJWT, async (req, res) => {
  await connectDB();
  const { carId, startDate, endDate } = req.body;
  const userEmail = req.user.email;

  const car = await cars.findOne({ _id: new ObjectId(carId) });
  if (!car) return res.status(404).send({ error: "Car not found" });

  const overlap = await bookings.findOne({
    carId: new ObjectId(carId),
    bookingStatus: { $in: ["confirmed", "pending"] },
    $or: [
      { startDate: { $lt: new Date(endDate) }, endDate: { $gt: new Date(startDate) } }
    ]
  });

  if (overlap) return res.status(409).send({ error: "Overlapping booking" });

  const totalDays = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)));
  const totalPrice = totalDays * car.dailyPrice;

  const booking = {
    carId: new ObjectId(carId),
    ownerEmail: userEmail,
    carModel: car.model,
    carImage: car.images?.[0] || "",
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    totalPrice,
    bookingStatus: "pending",
    createdAt: new Date()
  };

  const result = await bookings.insertOne(booking);
  await cars.updateOne({ _id: new ObjectId(carId) }, { $inc: { bookingCount: 1 } });
  res.send({ message: "Booking created", bookingId: result.insertedId });
});

app.put("/api/bookings/confirm/:id", verifyJWT, async (req, res) => {
  await connectDB();
  const id = req.params.id;
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

  const existing = await bookings.findOne({ _id: new ObjectId(id) });
  if (!existing || existing.ownerEmail !== req.user.email) return res.status(403).send("Unauthorized");

  const days = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)));
  const dailyRate = existing.totalPrice / ((new Date(existing.endDate) - new Date(existing.startDate)) / (1000 * 60 * 60 * 24));

  const result = await bookings.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        totalPrice: days * dailyRate,
      },
    }
  );

  res.send(result);
});

const handler = (req, res) => {
  app(req, res);
};

export default handler;
