const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// ✅ Check for required environment variables
if (!process.env.JWT_SECRET || !process.env.DB_USER || !process.env.DB_PASS) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

// Middleware
const allowedOrigins = [
  "http://localhost:5173", // Dev frontend
  "https://car-rental-169b3.web.app", // Deployed frontend
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.neq8pcg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// JWT Middleware
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

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB!");

    const db = client.db("carDB");
    const carsCollection = db.collection("rental");
    const bookingsCollection = db.collection("bookings");

    // JWT Token generation
    app.post("/jwt", (req, res) => {
      const user = req.body;
const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: "8h" });
      res.send({ token });
    });

    // Root Route
    app.get("/", (req, res) => {
      res.send("🚗 Welcome to the car rental world!");
    });

    // =====================
    // 🚘 Car Routes
    // =====================

    // Get all cars
    app.get("/cars", async (req, res) => {
      try {
        const cars = await carsCollection.find().toArray();
        res.send(cars);
      } catch (error) {
        res.status(500).send({ error: "Failed to retrieve cars" });
      }
    });

    // Get car by ID
    app.get("/cars/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
      const car = await carsCollection.findOne({ _id: new ObjectId(id) });
      if (!car) return res.status(404).send("Car not found");
      res.send(car);
    });

    // Add a car
    app.post("/cars", verifyJWT, async (req, res) => {
      try {
        const newCar = req.body;
          if (newCar.ownerEmail !== req.user.email) {
      return res.status(403).send("Forbidden: Email mismatch");
    }

        const result = await carsCollection.insertOne(newCar);
        res.status(201).send(result);
      } catch (error) {
          console.error("Error in /cars POST:", error);
        res.status(500).send({ error: "Failed to add car" });
      }
    });

    // Get cars by owner's email
    app.get("/my-cars", verifyJWT, async (req, res) => {
      const userEmail = req.query.email;
      if (req.user.email !== userEmail) {
        return res.status(403).send("Forbidden");
      }
      try {
        const cars = await carsCollection
          .find({ ownerEmail: userEmail })
          .toArray();
        res.send(cars);
      } catch (error) {
        res.status(500).send({ error: "Failed to retrieve user cars" });
      }
    });

    // Update a car
  app.put("/api/cars/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;
  const userEmail = req.user.email;

  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

  try {
    const car = await carsCollection.findOne({ _id: new ObjectId(id) });
    if (!car) return res.status(404).send("Car not found");
    if (car.ownerEmail !== userEmail) return res.status(403).send("Unauthorized");

    const result = await carsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );
    res.send({ message: "Car updated", result });
  } catch (error) {
    res.status(500).send({ error: "Failed to update car" });
  }
});

    // Delete a car
  app.delete("/api/cars/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const userEmail = req.user.email;

  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

  try {
    const car = await carsCollection.findOne({ _id: new ObjectId(id) });
    if (!car) return res.status(404).send("Car not found");
    if (car.ownerEmail !== userEmail) return res.status(403).send("Unauthorized");

    const result = await carsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send({ message: "Car deleted", result });
  } catch (error) {
    res.status(500).send({ error: "Failed to delete car" });
  }
});


    // =====================
    // 📅 Booking 


    // Create a booking
    app.post("/bookings", verifyJWT, async (req, res) => {
      try {
        const { carId, startDate, endDate } = req.body;
            const userEmail = req.user.email;
        if (!carId || !startDate || !endDate) {
          return res.status(400).send({ error: "Missing required fields" });
        }

        if (!ObjectId.isValid(carId)) {
          return res.status(400).send({ error: "Invalid car ID" });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start >= end) {
          return res.status(400).send({ error: "End date must be after start date" });
        }

        const car = await carsCollection.findOne({ _id: new ObjectId(carId) });
        if (!car) return res.status(404).send({ error: "Car not found" });

        const overlapping = await bookingsCollection.findOne({
          carId,
          bookingStatus: { $in: ["confirmed", "pending"] },
          $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }],
        });
        if (overlapping) {
          return res.status(409).send({ error: "Car already booked for selected dates" });
        }

        const oneDay = 24 * 60 * 60 * 1000;
        const days = Math.round(Math.abs((end - start) / oneDay)) || 1;
        const totalPrice = days * car.dailyPrice;

        const newBooking = {
          carId,
          ownerEmail: userEmail,
          carModel: car.model,
          carImage: car.images?.[0] || "",
          startDate: start,
          endDate: end,
          totalPrice,
          bookingStatus: "pending",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);

        await carsCollection.updateOne(
          { _id: new ObjectId(carId) },
          { $inc: { bookingCount: 1 } }
        );

        res.status(201).send({ message: "Booking created", bookingId: result.insertedId });
      } catch (error) {
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // Get bookings by user email
    app.get("/bookings", verifyJWT, async (req, res) => {
      const userEmail = req.query.email;
      if (req.user.email !== userEmail) {
        return res.status(403).send("Forbidden");
      }
    try {
    const bookings = await bookingsCollection.aggregate([
      {
        $match: { ownerEmail: userEmail },
      },
      {
        $lookup: {
          from: "rental", // the cars collection name
          localField: "carId",
          foreignField: "_id",
          as: "carDetails",
        },
      },
      {
        $unwind: "$carDetails", // flatten the array from $lookup
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $project: {
          _id: 1,
          startDate: 1,
          endDate: 1,
          totalPrice: 1,
          bookingStatus: 1,
          createdAt: 1,
          carId: 1,
          carModel: "$carDetails.model",
          carImage: { $arrayElemAt: ["$carDetails.images", 0] },
          ownerEmail: 1,
        },
      },
    ]).toArray();

    res.send(bookings); 
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).send({ error: "Failed to retrieve bookings" });
  }
});

    // Modify booking
    app.put("/bookings/modify/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { startDate, endDate } = req.body;
      if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start >= end) {
        return res.status(400).send({ error: "Invalid date range" });
      }

      try {
        const existing = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).send({ error: "Booking not found" });
        if (req.user.email !== existing.ownerEmail) {
          return res.status(403).send({ error: "Unauthorized" });
        }

        const conflict = await bookingsCollection.findOne({
          _id: { $ne: new ObjectId(id) },
          carId: existing.carId,
          bookingStatus: { $in: ["confirmed", "pending"] },
          $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }],
        });
        if (conflict) {
          return res.status(409).send({ error: "Car already booked for new dates" });
        }

        const originalDays = Math.max(1, Math.round(
          (new Date(existing.endDate) - new Date(existing.startDate)) /
          (1000 * 60 * 60 * 24)
        ));
        const newDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
        const dailyRate = existing.totalPrice / originalDays;
        const updatedPrice = newDays * dailyRate;

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              startDate: start,
              endDate: end,
              totalPrice: updatedPrice,
            },
          }
        );
        res.send({ message: "Booking updated", result });
      } catch (err) {
        res.status(500).send({ error: "Failed to update booking" });
      }
    });

    // Cancel booking
    app.put("/bookings/cancel/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");
      try {
        const existing = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).send({ error: "Booking not found" });
        if (req.user.email !== existing.ownerEmail) {
          return res.status(403).send({ error: "Unauthorized" });
        }

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { bookingStatus: "cancelled" } }
        );
        res.send({ message: "Booking cancelled", result });
      } catch (err) {
        res.status(500).send({ error: "Failed to cancel booking" });
      }
    });

    // Start server
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run();
