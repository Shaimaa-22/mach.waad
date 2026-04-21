const API = "https://YOUR-BACKEND.onrender.com";

async function register() {
  const body = {
    patientName: document.getElementById("patientName").value,
    age: document.getElementById("age").value
  };

  const res = await fetch(`${API}/api/register-patient`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  localStorage.setItem("patientId", data.patientId);
  location.href = "dashboard.html";
}

async function loadLatest() {
  const patientId = localStorage.getItem("patientId");
  const res = await fetch(`${API}/api/patients/${patientId}/latest`);
  const data = await res.json();

  const valueEl = document.getElementById("value");
  const statusEl = document.getElementById("status");
  const timeEl = document.getElementById("time");

  valueEl.textContent = data?.glucoseValue
    ? `${data.glucoseValue} mg/dL`
    : "--";

  const statusText = data?.status || "--";
  statusEl.textContent = statusText;

  statusEl.className = "status-pill";
  if (statusText === "HIGH") statusEl.classList.add("high");
  else if (statusText === "NORMAL") statusEl.classList.add("normal");
  else if (statusText === "LOW") statusEl.classList.add("low");

  timeEl.textContent = data?.createdAt
    ? new Date(data.createdAt).toLocaleString()
    : "--";
}
