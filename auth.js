const authApi = "https://media2.edu.metropolia.fi/restaurant/api/v1";

const authModal = document.querySelector("#auth-modal");
const authMessage = document.querySelector("#auth-message");
const authTabs = document.querySelectorAll(".auth-tab");
const authTabsContainer = document.querySelector(".auth-tabs");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const headerAvatar = document.querySelector("#header-avatar");
const openLoginButton = document.querySelector("#open-login");
const openRegisterButton = document.querySelector(".btn-signup");
let currentUser = {
    username: localStorage.getItem("restaurant_username")
        || (localStorage.getItem("restaurant_user_token") ? "User" : ""),
    email: localStorage.getItem("restaurant_email") || "",
    avatar: localStorage.getItem("restaurant_avatar") || ""
};
function normalizeAvatarUrl(value) {
    if (value && typeof value === "object") {
        value = value.url || value.path || value.avatarUrl || value.avatar_url;
    }
    if (typeof value !== "string" || !value) return "";
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith("//")) return `${location.protocol}${value}`;
    if (value.startsWith("/")) return `${new URL(authApi).origin}${value}`;
    return new URL(value, `${authApi}/`).href;
}

function showAvatar(image, value) {
    const url = normalizeAvatarUrl(value);
    if (!url) return;
    image.onerror = function () {
        image.onerror = null;
        image.hidden = true;
    };
    image.src = url;
    image.hidden = false;
}

function updateAuthButtons() {
    let loggedIn = false;
    if (localStorage.getItem("restaurant_user_token") && currentUser.username) loggedIn = true;
    openLoginButton.textContent = loggedIn ? translate("Profile") : translate("Sign in");
    openRegisterButton.hidden = loggedIn;
    headerAvatar.hidden = !loggedIn || !currentUser.avatar;
    if (currentUser.avatar) showAvatar(headerAvatar, currentUser.avatar);
}

function showAuthForm(view) {
    authTabsContainer.hidden = false;
    loginForm.hidden = view !== "login";
    registerForm.hidden = view !== "register";
    document.querySelector("#auth-title").textContent = view === "register"
        ? translate("Create account")
        : translate("Sign in");
    authMessage.textContent = "";
    for (const tab of authTabs) {
        tab.classList.toggle("active", tab.dataset.authView === view);
    }
}

function openAuth(view) {
    authModal.showModal();
    showAuthForm(view);
    const firstInput = view === "login" ? "#login-username" : "#register-username";
    document.querySelector(firstInput).focus();
}

openLoginButton.addEventListener("click", function () {
    if (localStorage.getItem("restaurant_user_token")) {
        window.location.href = "profile.html";
        return;
    }
    openAuth("login");
});

openRegisterButton.addEventListener("click", function () {
    openAuth("register");
});

for (const tab of authTabs) {
    tab.addEventListener("click", function () {
        showAuthForm(tab.dataset.authView);
    });
}

for (const closeButton of authModal.querySelectorAll("[data-close-auth]")) {
    closeButton.addEventListener("click", function () {
        authModal.close();
    });
}

authModal.addEventListener("click", function (event) {
    if (event.target === authModal) authModal.close();
});

async function sendAuthRequest(path, form) {
    const submitButton = form.querySelector("[type='submit']");
    submitButton.disabled = true;
    authMessage.textContent = translate("Please wait...");

    const fields = new FormData(form);
    const body = {};
    for (const [key, value] of fields.entries()) {
        body[key] = value;
    }

    try {
        const response = await fetch(`${authApi}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const responseText = await response.text();
        let data = {};
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch {
            data = { message: responseText };
        }

        if (!response.ok) {
            throw new Error(data.message || data.error || data.detail || `Request failed (${response.status})`);
        }
        return data;
    } finally {
        submitButton.disabled = false;
    }
}

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  try {
    const data = await sendAuthRequest("/auth/login", loginForm);
    
    if (data.token) {
      localStorage.setItem("restaurant_user_token", data.token);
    }
    const user = data.user || {};
    currentUser = {
      username: user.username || loginForm.elements.username.value,
      email: user.email || localStorage.getItem("restaurant_email") || "",
      avatar: normalizeAvatarUrl(user.avatar) || localStorage.getItem("restaurant_avatar") || ""
    };

    localStorage.setItem("restaurant_username", currentUser.username);
    localStorage.setItem("restaurant_email", currentUser.email);
    if (currentUser.avatar) {
      localStorage.setItem("restaurant_avatar", currentUser.avatar);
    }

    updateAuthButtons();
    window.dispatchEvent(new Event("restaurant-auth-changed"));
    authMessage.textContent = translate("You are signed in.");
    loginForm.reset();

    setTimeout(() => {
      if (authModal.open) authModal.close();
    }, 700);

  } catch (error) {
    authMessage.textContent = error.message || translate("Sign in failed. Please try again.");
  }
});
registerForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  // Clear previous status messages
  if (authMessage) authMessage.textContent = "";

  // 1. Safely extract values from input fields without throwing errors
  const username =
    registerForm.elements["username"]?.value ||
    registerForm.elements["käyttäjätunnus"]?.value ||
    registerForm.querySelector("input[type='text']")?.value ||
    "";

  const email =
    registerForm.elements["email"]?.value ||
    registerForm.elements["sähköposti"]?.value ||
    registerForm.querySelector("input[type='email']")?.value ||
    "";

  const password =
    registerForm.elements["password"]?.value ||
    registerForm.elements["salasana"]?.value ||
    registerForm.querySelector("input[type='password']")?.value ||
    "";

  // Basic client-side validation check
  if (!username || !email || !password) {
    authMessage.textContent = translate("Please fill in all fields.");
    return;
  }

  try {
    const response = await fetch("https://media2.edu.metropolia.fi/restaurant/api/v1/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: username.trim(),
        email: email.trim(),
        password: password
      })
    });

    const data = await response.json();


    const isSmtpError = data.message && data.message.includes("535 Authentication failed");

    if (!response.ok && !isSmtpError) {
      throw new Error(data.message || data.error || translate("Could not create account."));
    }

    // 4. Save email to localStorage so profile pages can use it even if backend mailer failed
    localStorage.setItem("restaurant_email", email.trim());
    localStorage.setItem("restaurant_username", username.trim());

    // 5. Success UI state
    registerForm.reset();

    // Switch view to login form if function exists
    if (typeof showAuthForm === "function") {
      showAuthForm("login");
    }

    authMessage.textContent = translate("Account created! Please sign in.");

  } catch (error) {
    authMessage.textContent = error.message || translate("Could not create your account. Please try again.");
  }
});
updateAuthButtons();

window.addEventListener("language-change", () => {
    updateAuthButtons();
    document.querySelector("#auth-title").textContent = translate(
        registerForm.hidden ? "Sign in" : "Create account"
    );
});
