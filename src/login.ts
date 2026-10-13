import './login.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const username = import.meta.env.VITE_LOGIN_USERNAME;
const password = import.meta.env.VITE_LOGIN_PASSWORD;
// This static-site gate is for development convenience, not server authorization.
const sessionKey = 'dental-studio-login-v1';

function hasSession() {
  try { return sessionStorage.getItem(sessionKey) === 'authenticated'; }
  catch { return false; }
}

async function openWorkspace() {
  const module = await import('./main');
  return module;
}

async function start() {
  document.title = '研发测试工具';
  if (username && password && hasSession()) {
    try { await openWorkspace(); return; }
    catch { /* Show the form again so loading can be retried. */ }
  }

  app.innerHTML = `
    <main class="login-page">
      <section class="login-card" aria-labelledby="login-title">
        <div class="login-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 26V14a9 9 0 0 1 18 0v12h-4V14a5 5 0 0 0-10 0v12z"/></svg>
        </div>
        <h1 id="login-title">研发测试工具</h1>
        <form id="login-form">
          <label for="login-username">用户名</label>
          <input id="login-username" name="username" autocomplete="username" placeholder="请输入用户名" required autofocus />
          <label for="login-password">密码</label>
          <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required />
          <p id="login-error" class="login-error" role="alert" aria-live="polite"></p>
          <button class="login-submit" type="submit">登录</button>
        </form>
      </section>
    </main>`;

  const form = document.querySelector<HTMLFormElement>('#login-form')!;
  const usernameInput = document.querySelector<HTMLInputElement>('#login-username')!;
  const passwordInput = document.querySelector<HTMLInputElement>('#login-password')!;
  const error = document.querySelector<HTMLParagraphElement>('#login-error')!;
  const submit = document.querySelector<HTMLButtonElement>('.login-submit')!;
  usernameInput.focus();
  form.addEventListener('input', () => {
    error.textContent = '';
    passwordInput.removeAttribute('aria-invalid');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    if (!username || !password) {
      error.textContent = '登录账号尚未配置，请联系管理员。';
      return;
    }
    if (usernameInput.value.trim() !== username || passwordInput.value !== password) {
      error.textContent = '用户名或密码错误，请重试。';
      passwordInput.setAttribute('aria-invalid', 'true');
      passwordInput.value = '';
      passwordInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = '正在进入…';
    try {
      await openWorkspace();
      try { sessionStorage.setItem(sessionKey, 'authenticated'); }
      catch { /* Login still works when browser storage is disabled. */ }
    } catch {
      // A failed module can have partially replaced the form; reload for a clean retry.
      app.innerHTML = '<main class="login-page"><section class="login-card"><h1>研发测试工具</h1><p role="alert">工具加载失败，请刷新页面重试。</p><button class="login-submit" id="login-reload">刷新页面</button></section></main>';
      document.querySelector('#login-reload')!.addEventListener('click', () => location.reload());
    }
  });
}

void start();
