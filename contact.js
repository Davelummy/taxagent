const contactForm = document.getElementById("contact-form");
const contactMessage = document.getElementById("contact-message");

const setContactMessage = (message, type = "info") => {
  if (!contactMessage) return;
  contactMessage.textContent = message;
  contactMessage.className = `portal-message ${type}`.trim();
};

if (contactForm) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!contactForm.checkValidity()) {
      setContactMessage("Complete the required fields so we can respond.", "error");
      return;
    }

    const data = new FormData(contactForm);
    const name = data.get("name") || "";
    const email = data.get("email") || "";
    const company = data.get("company") || "";
    const role = data.get("role") || "";
    const preferredTime = data.get("preferred_time") || "";
    const message = data.get("message") || "";

    const payload = {
      name,
      email,
      company,
      role,
      preferred_time: preferredTime,
      message,
    };

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to send request.");
        }
        setContactMessage("Request received. The ASTA team will follow up shortly.", "success");
        contactForm.reset();
      })
      .catch(() => {
        const subject = `ASTA Reach the Team - ${name || "New inquiry"}`;
        const body = [
          `Name: ${name}`,
          `Email: ${email}`,
          `Taxpayer or preparer: ${company}`,
          `Role: ${role}`,
          `Preferred time: ${preferredTime}`,
          "",
          "Request details:",
          message,
        ].join("\n");
        const mailto = `mailto:support@atlassecuretax.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.location.href = mailto;
        setContactMessage("Email draft opened. Send to confirm your request.", "success");
      });
  });
}
