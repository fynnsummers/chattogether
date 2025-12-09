document.addEventListener('DOMContentLoaded', function () {
  // Tabs
  const loginTab = document.getElementById('login-tab');
  const registerTab = document.getElementById('register-tab');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  loginTab.addEventListener('click', function () {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.style.display = '';
    registerForm.style.display = 'none';
  });
  registerTab.addEventListener('click', function () {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    registerForm.style.display = '';
    loginForm.style.display = 'none';
  });

  // Login
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const room = document.getElementById('login-room').value;
    const errorDiv = document.getElementById('login-error');
    errorDiv.style.display = 'none';
    errorDiv.textContent = '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        window.location = `chat.html?username=${encodeURIComponent(username)}&room=${encodeURIComponent(room)}`;
      } else {
        errorDiv.textContent = data.message || 'Login fehlgeschlagen.';
        errorDiv.style.display = 'block';
      }
    } catch (err) {
      errorDiv.textContent = 'Serverfehler beim Login.';
      errorDiv.style.display = 'block';
    }
  });

  // Registrierung
  registerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const displayName = document.getElementById('register-displayname').value.trim();
    const errorDiv = document.getElementById('register-error');
    const successDiv = document.getElementById('register-success');
    errorDiv.style.display = 'none';
    errorDiv.textContent = '';
    successDiv.style.display = 'none';
    successDiv.textContent = '';
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName })
      });
      const data = await res.json();
      if (data.success) {
        successDiv.textContent = 'Registrierung erfolgreich! ';
        successDiv.style.display = 'block';
        // Optional: Automatisch zum Login-Tab wechseln
        setTimeout(() => {
          loginTab.click();
        }, 1500);
      } else {
        errorDiv.textContent = data.message || 'Registrierung fehlgeschlagen.';
        errorDiv.style.display = 'block';
      }
    } catch (err) {
      errorDiv.textContent = 'Serverfehler bei der Registrierung.';
      errorDiv.style.display = 'block';
    }
  });
});
