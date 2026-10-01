// Page navigation and submission form for the Foil House bulk site.
// Depends on SITE_CONFIG from config.js.

const VIEWS = ["form", "shipping", "info"];
const $ = (id) => document.getElementById(id);

/* ---------- Navigation (hash-based views) ---------- */

function showView() {
  const requested = (location.hash || "#form").slice(1);
  const view = VIEWS.includes(requested) ? requested : "form";
  VIEWS.forEach((id) => {
    $(id).style.display = id === view ? "block" : "none";
  });
  window.scrollTo(0, 0);
}

/* ---------- Submission form ---------- */

function buildSubmissionText(data) {
  const get = (key) => (data.get(key) || "").toString().trim();
  const contents = data.getAll("kind").join(", ") || "not specified";

  return [
    "NEW BULK SUBMISSION",
    "",
    `Name: ${get("name")}`,
    `Email: ${get("email")}`,
    `PayPal: ${get("paypal")}`,
    `Phone: ${get("phone") || "-"}`,
    "",
    `Ship from: ${get("street")}, ${get("city")}, ${get("state").toUpperCase()} ${get("zip")}`,
    "",
    `Approx. cards: ${get("count")}`,
    `Est. weight (lbs): ${get("weight")}`,
    `Contents: ${contents}`,
    `Condition: ${get("condition") || "-"}`,
    `Hoping for: ${get("ask") || "-"}`,
    `Notes: ${get("notes") || "-"}`,
    "",
    "Confirmed: cards are mine to sell, I'm 18+, I agree to the program policy.",
    "(Photos attached to this email.)",
  ].join("\n");
}

function handleSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const body = buildSubmissionText(data);
  const name = (data.get("name") || "").toString().trim();
  const subject = `Bulk submission - ${name}`;

  // Fallback box in case no mail app opens
  $("txt").value = body;
  $("out").style.display = "block";

  location.href =
    `mailto:${SITE_CONFIG.submissionEmail}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $("out").scrollIntoView({ behavior: "smooth" });
}

function copyDetails() {
  const box = $("txt");
  box.select();
  try {
    navigator.clipboard.writeText(box.value);
  } catch (err) {
    document.execCommand("copy");
  }
}

/* ---------- Init ---------- */

$("to").textContent = SITE_CONFIG.submissionEmail;
$("f").addEventListener("submit", handleSubmit);
$("copy").addEventListener("click", copyDetails);
window.addEventListener("hashchange", showView);
showView();
