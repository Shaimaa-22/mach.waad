require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const path = require("path");

const app = express();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

const SYSTEM_DOCTOR = {
  name: "د. أحمد",
  email: "shaimaadwedar03@gmail.com",
  whatsapp: "9720594608763"
};

const NORMAL_RANGE = {
  min: 70,
  max: 140
};

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

async function sendEmail(to, subject, text) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text
  });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      normal_min DOUBLE PRECISION NOT NULL DEFAULT 70,
      normal_max DOUBLE PRECISION NOT NULL DEFAULT 140,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS readings (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      glucose_value DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getOrCreateDoctor() {
  const existing = await pool.query(`SELECT * FROM doctors LIMIT 1`);

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const created = await pool.query(
    `
    INSERT INTO doctors (full_name, email, whatsapp_number)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [SYSTEM_DOCTOR.name, SYSTEM_DOCTOR.email, SYSTEM_DOCTOR.whatsapp]
  );

  return created.rows[0];
}

app.post("/api/register-patient", async (req, res) => {
  try {
    const { patientName, age } = req.body;

    const doctor = await getOrCreateDoctor();

    const result = await pool.query(
      `
      INSERT INTO patients (full_name, age, normal_min, normal_max, doctor_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [patientName, Number(age), NORMAL_RANGE.min, NORMAL_RANGE.max, doctor.id]
    );

    res.json({
      success: true,
      patientId: result.rows[0].id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/readings", async (req, res) => {
  try {
    const { patientId, value } = req.body;

    const patientResult = await pool.query(
      `
      SELECT p.*, d.email AS doctor_email, d.whatsapp_number AS doctor_whatsapp
      FROM patients p
      JOIN doctors d ON p.doctor_id = d.id
      WHERE p.id = $1
      `,
      [Number(patientId)]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patient = patientResult.rows[0];

    let status = "NORMAL";
    if (Number(value) > patient.normal_max) status = "HIGH";
    else if (Number(value) < patient.normal_min) status = "LOW";

    const readingResult = await pool.query(
      `
      INSERT INTO readings (patient_id, glucose_value, status)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [patient.id, Number(value), status]
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
      reading: readingResult.rows[0],
      whatsappLink
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/patients/:id/latest", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM readings
      WHERE patient_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [Number(req.params.id)]
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

initDb().then(() => {
  app.listen(process.env.PORT || 10000, () => {
    console.log(`Running on ${process.env.PORT || 10000}`);
  });
});
