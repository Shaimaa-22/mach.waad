require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const dbPath = path.join(__dirname, "glucose.db");
const db = new sqlite3.Database(dbPath);

const SYSTEM_DOCTOR = {
  name: "د. أحمد",
  email: "shaimaadwedar03@gmail.com ,ahmadradialbatal@gmail.com , waaddwedar20@gmail.com",
  whatsapp: "9720594608763"
};

const NORMAL_RANGE = {
  min: 70,
  max: 140
};

let activePatientId = null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function sendEmail(to, subject, text) {
  return transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS doctors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          whatsapp_number TEXT NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS patients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          age INTEGER NOT NULL,
          normal_min REAL NOT NULL DEFAULT 70,
          normal_max REAL NOT NULL DEFAULT 140,
          doctor_id INTEGER NOT NULL,
          FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL,
          glucose_value REAL NOT NULL,
          status TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function getOrCreateDoctor() {
  const existing = await get(`SELECT * FROM doctors LIMIT 1`);

  if (existing) return existing;

  const result = await run(
    `
      INSERT INTO doctors (full_name, email, whatsapp_number)
      VALUES (?, ?, ?)
    `,
    [SYSTEM_DOCTOR.name, SYSTEM_DOCTOR.email, SYSTEM_DOCTOR.whatsapp]
  );

  return {
    id: result.lastID,
    full_name: SYSTEM_DOCTOR.name,
    email: SYSTEM_DOCTOR.email,
    whatsapp_number: SYSTEM_DOCTOR.whatsapp
  };
}

app.post("/api/register-patient", async (req, res) => {
  try {
    const { patientName, age } = req.body;

    if (!patientName || !age) {
      return res.status(400).json({ error: "patientName and age are required" });
    }

    const doctor = await getOrCreateDoctor();

    const result = await run(
      `
        INSERT INTO patients (full_name, age, normal_min, normal_max, doctor_id)
        VALUES (?, ?, ?, ?, ?)
      `,
      [patientName, Number(age), NORMAL_RANGE.min, NORMAL_RANGE.max, doctor.id]
    );

    activePatientId = result.lastID;

    res.json({
      success: true,
      patientId: result.lastID
    });
  } catch (error) {
    console.error("register-patient error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/readings", async (req, res) => {
  try {
    const { patientId, value } = req.body;
    const targetPatientId = patientId || activePatientId;

    if (!targetPatientId) {
      return res.status(400).json({ error: "No active patient selected" });
    }

    const patient = await get(
      `
        SELECT
          p.id,
          p.full_name,
          p.age,
          p.normal_min,
          p.normal_max,
          d.email AS doctor_email,
          d.whatsapp_number AS doctor_whatsapp
        FROM patients p
        JOIN doctors d ON p.doctor_id = d.id
        WHERE p.id = ?
      `,
      [Number(targetPatientId)]
    );

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    let status = "NORMAL";
    if (Number(value) > patient.normal_max) status = "HIGH";
    else if (Number(value) < patient.normal_min) status = "LOW";

    const readingResult = await run(
      `
        INSERT INTO readings (patient_id, glucose_value, status)
        VALUES (?, ?, ?)
      `,
      [patient.id, Number(value), status]
    );

    const reading = await get(
      `
        SELECT
          id,
          patient_id AS patientId,
          glucose_value AS glucoseValue,
          status,
          created_at AS createdAt
        FROM readings
        WHERE id = ?
      `,
      [readingResult.lastID]
    );

    let whatsappLink = null;

    if (status === "HIGH") {
      const msg = `تنبيه ارتفاع سكر

اسم المريض: ${patient.full_name}
العمر: ${patient.age}
القراءة الحالية: ${value} mg/dL
الطبيعي: ${patient.normal_min}-${patient.normal_max}`;

      await sendEmail(
        patient.doctor_email,
        `تنبيه سكر - ${patient.full_name}`,
        msg
      );

      const doctorPhone = patient.doctor_whatsapp.replace(/\D/g, "");
      whatsappLink = `https://wa.me/${doctorPhone}?text=${encodeURIComponent(msg)}`;
    }

    res.json({
      success: true,
      reading,
      whatsappLink
    });
  } catch (error) {
    console.error("readings error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/patients/:id/latest", async (req, res) => {
  try {
    const reading = await get(
      `
        SELECT
          id,
          patient_id AS patientId,
          glucose_value AS glucoseValue,
          status,
          created_at AS createdAt
        FROM readings
        WHERE patient_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `,
      [Number(req.params.id)]
    );

    res.json(reading || null);
  } catch (error) {
    console.error("latest reading error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, activePatientId });
});

initDb()
  .then(() => {
    app.listen(process.env.PORT || 10000, () => {
      console.log(`Running on ${process.env.PORT || 10000}`);
    });
  })
  .catch((error) => {
    console.error("Database init failed:", error);
    process.exit(1);
  });
