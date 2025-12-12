import { supabase } from "../supabase.client.js";

export function showLoginUI() {
  document.getElementById("login-section").style.display = "block";

  const btn = document.getElementById("btn-login");
  const msg = document.getElementById("auth-msg");

  btn.addEventListener("click", async () => {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) {
      msg.textContent = "Voer een geldig emailadres in";
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      msg.textContent = "Fout bij verzenden: " + error.message;
    } else {
      msg.textContent =
        "Magic link verzonden! Check je e-mail (en spam).";
    }
  });
}

export async function handleLogout() {
  await supabase.auth.signOut();
  window.location.reload();
}
