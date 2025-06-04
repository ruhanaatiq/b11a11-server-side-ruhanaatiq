const express = require('express');
const cors = require('cors');
const app = express();
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.neq8pcg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB!");

    const db = client.db("carDB"); // Replace with your actual DB name
    const carsCollection = db.collection("rental");

    // Example GET route
    app.get('/cars', async (req, res) => {
      const cars = await carsCollection.find().toArray();
      res.send(cars);
    });

    // Root route
    app.get('/', (req, res) => {
      res.send('🚗 Welcome to the car rental world!');
    });

    // Start server inside try block
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });

  } catch (err) {
    console.error(" MongoDB connection error:", err);
  }
}

run();
