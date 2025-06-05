const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId  } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

    // 🔐 Token generation (login)
    app.post('/jwt', (req, res) => {
      const user = req.body; // Expecting { email: "user@example.com" }
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '2h' });
      res.send({ token });
    });

    // ➕ Add a car (optional: protect this with JWT)
    app.post('/cars', async (req, res) => {
      try {
        const newCar = req.body;
        const result = await carsCollection.insertOne(newCar);
        res.status(201).send(result);
      } catch (error) {
        console.error("❌ Error adding car:", error);
        res.status(500).send({ error: "Failed to add car" });
      }
    });

    // ✅ PUBLIC: Get all cars (recent listings)
    app.get('/cars', async (req, res) => {
      try {
        const cars = await carsCollection.find().toArray();
        res.send(cars);
      } catch (error) {
        console.error("❌ Failed to fetch cars:", error);
        res.status(500).send({ error: "Failed to retrieve cars" });
      }
    });

    // 🌐 Root route
    app.get('/', (req, res) => {
      res.send('🚗 Welcome to the car rental world!');
    });
app.get("/cars/:id", async (req, res) => {
  const id = req.params.id;
  const car = await carsCollection.findOne({ _id: new ObjectId(id) });
  if (!car) return res.status(404).send("Car not found");
  res.send(car);
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
