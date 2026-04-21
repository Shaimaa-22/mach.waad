
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const nodemailer = require("nodemailer");

const prisma = new PrismaClient();
const app = express();
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
app.use(express.static("../frontend"));

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail(to, subject, text){
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
     text
  });
}

app.post("/api/register-patient", async(req,res)=>{

  const { patientName, age } = req.body;

  let doctor = await prisma.doctor.findFirst();

  if(!doctor){
    doctor = await prisma.doctor.create({
      data:{
        fullName: SYSTEM_DOCTOR.name,
        email: SYSTEM_DOCTOR.email,
        whatsappNumber: SYSTEM_DOCTOR.whatsapp
      }
    });
  }

  const patient = await prisma.patient.create({
    data:{
      fullName: patientName,
      age: Number(age),
      normalMin: NORMAL_RANGE.min,
      normalMax: NORMAL_RANGE.max,
      doctorId: doctor.id
    }
  });

  res.json({
    success:true,
    patientId: patient.id
  });
});

app.post("/api/readings", async (req, res) => {
  const { patientId, value } = req.body;

  const patient = await prisma.patient.findUnique({
    where: { id: Number(patientId) },
    include: { doctor: true }
  });

  if (!patient) {
    return res.status(404).json({ error: "Patient not found" });
  }

  let status = "NORMAL";
  if (value > patient.normalMax) status = "HIGH";
  else if (value < patient.normalMin) status = "LOW";

  const reading = await prisma.reading.create({
    data: {
      patientId: patient.id,
      glucoseValue: Number(value),
      status
    }
  });

  let whatsappLink = null;

  if (status === "HIGH") {
    const msg = `تنبيه ارتفاع سكر

اسم المريض: ${patient.fullName}
العمر: ${patient.age}
القراءة الحالية: ${value} mg/dL
الطبيعي: ${patient.normalMin}-${patient.normalMax}`;

    await sendEmail(
      patient.doctor.email,
      `تنبيه سكر - ${patient.fullName}`,
      msg
    );

    const doctorPhone = patient.doctor.whatsappNumber.replace(/\D/g, "");
    whatsappLink = `https://wa.me/${doctorPhone}?text=${encodeURIComponent(msg)}`;
  }

  res.json({
    success: true,
    reading,
    whatsappLink
  });
});

app.get("/api/patients/:id/latest", async(req,res)=>{
  const reading = await prisma.reading.findFirst({
     where:{ patientId:Number(req.params.id) },
    orderBy:{ createdAt:"desc" }
  });
  res.json(reading);
});

app.listen(process.env.PORT, ()=> console.log(`Running on ${process.env.PORT}`));