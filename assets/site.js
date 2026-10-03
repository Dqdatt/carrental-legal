/* Mã dùng chung cho mọi trang của carrental.id.vn: giao diện sáng/tối, menu, đăng nhập (cùng tài khoản app), gọi máy chủ.
   CFG do web/build.js chèn vào trước file này. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
const moneyK = n => n >= 1000 && n % 1000 === 0 ? money(n).replace(/\.000đ$/, 'k') : money(n);
const pad2 = n => String(n).padStart(2, '0');
const D = s => s ? new Date(s) : null;
const fDate = d => (d = D(d)) ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
const fTime = d => (d = D(d)) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
const daysLeft = d => Math.max(0, Math.ceil((D(d) - Date.now()) / 864e5));
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ICON = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${CFG.icons[name] || ''}</svg>`;
const PLAN_NAMES = { free: 'Miễn phí', basic: 'Cơ bản', pro: 'Nâng cao', fleet: 'Cao cấp' };
const CAR_LIMIT = { free: 2, basic: 5, pro: 10, fleet: null };

const ERR = {
  invalid_credentials: 'Sai thông tin đăng nhập hoặc mật khẩu.', user_banned: 'Tài khoản đang tạm khoá. Liên hệ hỗ trợ.',
  network: 'Không kết nối được, kiểm tra mạng rồi thử lại.', login: 'Phiên đăng nhập đã hết, đăng nhập lại.',
  otp_expired: 'Mã không đúng hoặc đã hết hạn.', over_email_send_rate_limit: 'Gửi mã nhiều quá, chờ một phút rồi thử lại.',
  otp_disabled: 'Email này chưa có tài khoản CarRental.', user_not_found: 'Email này chưa có tài khoản CarRental.',
  weak_password: 'Mật khẩu từ 8 ký tự, có cả chữ và số.', same_password: 'Mật khẩu mới phải khác mật khẩu cũ.',
  bad_phone: 'Số điện thoại chưa đúng.', bad_email: 'Email chưa đúng.', need_contact: 'Nhập số điện thoại hoặc email để được liên hệ lại.',
  too_many: 'Đang có nhiều yêu cầu, thử lại sau ít phút.', too_many_messages: 'Gửi nhiều quá, thử lại sau ít phút.',
  empty_message: 'Nhập nội dung.', not_found: 'Không tìm thấy tài khoản chủ xe.',
};
const errText = e => ERR[e?.message] || e?.message || 'Có lỗi, thử lại.';
class ApiError extends Error {}

/* ============ Máy chủ ============ */
async function http(path, { method = 'POST', body, auth = false, headers = {} } = {}) {
  const h = { apikey: CFG.sbKey, 'Content-Type': 'application/json', ...headers };
  if (auth) h.Authorization = `Bearer ${await Auth.token()}`;
  let r;
  try { r = await fetch(CFG.sbUrl + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('network'); }
  const text = await r.text();
  const j = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (r.status === 401 && auth) { Auth.clear(); throw new ApiError('login'); }
  if (!r.ok) throw new ApiError(j?.error_code || j?.code === 'P0001' && j?.message || j?.message || j?.msg || j?.error || `Lỗi ${r.status}`);
  return j;
}
const rpc = (name, params = {}, auth = true) => http(`/rest/v1/rpc/${name}`, { body: params, auth });

/* ============ Đăng nhập (cùng tài khoản app CarRental) ============ */
const Auth = {
  KEY: 'cr-session',
  get() { return ls.get(this.KEY); },
  save(j) {
    const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: j.user?.email || '' };
    ls.set(this.KEY, s); return s;
  },
  clear() { ls.set(this.KEY, null); },
  /** Email đăng nhập: có chữ hoặc "@" là email, còn lại là số điện thoại → email nội bộ như app (AuthText.isEmailLogin) */
  loginEmail(v) {
    v = v.trim().toLowerCase();
    if (/[a-z@]/.test(v)) return v;
    let d = v.replace(/\D/g, '');
    if (d.startsWith('0')) d = '84' + d.slice(1);
    return `${d}@phone.example.com`;
  },
  async signIn(id, password) {
    const j = await http('/auth/v1/token?grant_type=password', { body: { email: this.loginEmail(id), password } });
    return this.save(j);
  },
  async token() {
    const s = this.get();
    if (!s) throw new ApiError('login');
    if (s.expires_at - Date.now() > 60e3) return s.access_token;
    try { return this.save(await http('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })).access_token; }
    catch (e) { if (e.message !== 'network') this.clear(); throw e.message === 'network' ? e : new ApiError('login'); }
  },
  /** Chỉ đăng xuất trên trình duyệt này (scope=local), không đăng xuất app trên điện thoại */
  async signOut() {
    const s = this.get();
    if (s) http('/auth/v1/logout?scope=local', { headers: { Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
    this.clear();
  },
  sendCode: email => http('/auth/v1/otp', { body: { email: email.trim().toLowerCase(), create_user: false } }),
  async verifyCode(email, token) { return this.save(await http('/auth/v1/verify', { body: { type: 'email', email: email.trim().toLowerCase(), token } })); },
  setPassword: password => http('/auth/v1/user', { method: 'PUT', body: { password }, auth: true }),
};
const goodPassword = p => p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);

/* ============ Nguồn khách (quảng cáo): giữ utm_* và trang giới thiệu để gửi kèm form liên hệ ============ */
(() => {
  const q = new URLSearchParams(location.search), keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const cur = ls.get('cr-src'), hasUtm = keys.some(k => q.get(k));
  const ext = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer.slice(0, 200) : '';
  // Lần đầu vào, hoặc vào lại từ một quảng cáo mới (có utm): ghi lại nguồn
  if (!cur || hasUtm) {
    const v = { first_page: location.pathname, at: Date.now() };
    keys.forEach(k => { if (q.get(k)) v[k] = q.get(k).slice(0, 200); });
    if (ext) v.ref = ext;
    ls.set('cr-src', v);
  }
})();
const leadSource = () => ({ ...(ls.get('cr-src') || {}), page: location.pathname });

/* ============ Giao diện ============ */
let toastT;
function toast(m) { const t = $('#toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }
async function copy(v) { try { await navigator.clipboard.writeText(v); toast('Đã chép'); } catch { toast(v); } }

const EYE = { show: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>', hide: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>' };
/** Nút mắt hiện/ẩn mật khẩu cho mọi ô mật khẩu trong vùng vừa vẽ */
function eyeify(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-eye])').forEach(inp => {
    inp.dataset.eye = '1';
    const wrap = document.createElement('div'); wrap.className = 'pw';
    inp.replaceWith(wrap); wrap.appendChild(inp);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pw-eye';
    const paint = () => { const shown = inp.type === 'text'; b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${shown ? EYE.hide : EYE.show}</svg>`;
      b.setAttribute('aria-label', shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'); b.title = b.getAttribute('aria-label'); };
    b.addEventListener('click', () => { inp.type = inp.type === 'password' ? 'text' : 'password'; paint(); inp.focus(); });
    paint(); wrap.appendChild(b);
  });
}

const themeDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
function paintTheme() {
  $$('.theme-btn').forEach(b => {
    const d = themeDark(), label = d ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
    b.innerHTML = ICON(d ? 'sun' : 'moon'); b.title = label; b.setAttribute('aria-label', label);
  });
}
function toggleTheme() {
  const t = themeDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('cr-theme', t); } catch {}
  paintTheme();
}

/* Bảng giá: lấy giá đang bán trên máy chủ, thay số trong trang (trang dựng sẵn giá mặc định để đọc được khi chưa tải xong) */
let pricesReq;
function loadPrices() {
  return pricesReq ||= (async () => {
    let list;
    try { list = await rpc('public_prices', {}, false); } catch { return null; }
    if (!Array.isArray(list) || !list.length) return null;
    $$('[data-price]').forEach(el => {
      const [plan, period, fmt] = el.dataset.price.split(':'), p = list.find(x => x.plan === plan && x.period === period);
      if (p) el.textContent = fmt === 'k' ? moneyK(p.amount) : money(p.amount);
    });
    return list;
  })();
}

/* Theo tháng / theo năm trên thẻ gói (Trang chủ, Bảng giá): đổi số trên thẻ và kỳ hạn mang sang trang Chọn gói */
function setPeriod(p) {
  $$('.seg [data-period]').forEach(b => { const on = b.dataset.period === p; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('[data-period-month]').forEach(el => el.hidden = p !== 'month');
  $$('[data-period-year]').forEach(el => el.hidden = p !== 'year');
  $$('[data-goi]').forEach(a => a.href = `${CFG.root}goi/?plan=${a.dataset.goi}&period=${p}`);
}

document.addEventListener('DOMContentLoaded', () => {
  paintTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
  $$('.theme-btn').forEach(b => b.addEventListener('click', toggleTheme));
  const menu = $('#menu'), mb = $('#menu-btn');
  mb?.addEventListener('click', () => {
    const open = menu.hidden; menu.hidden = !open; mb.setAttribute('aria-expanded', String(open));
    mb.innerHTML = ICON(open ? 'x' : 'menu');
  });
  const hdr = $('.hdr'), onScroll = () => hdr?.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  // Đã đăng nhập thì "Đăng nhập" thành "Tài khoản"
  if (Auth.get()) $$('[data-login]').forEach(a => { a.textContent = 'Tài khoản'; });
  // Hiện dần khi cuộn tới
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach(el => io.observe(el));
  } else $$('.reveal').forEach(el => el.classList.add('in'));
  $$('.seg [data-period]').forEach(b => b.addEventListener('click', () => setPeriod(b.dataset.period)));
  if ($('[data-price]')) loadPrices().then(list => {
    // Phần trăm bớt khi trả theo năm, theo giá thật của gói Cơ bản
    const m = list?.find(x => x.plan === 'basic' && x.period === 'month')?.amount, y = list?.find(x => x.plan === 'basic' && x.period === 'year')?.amount;
    if (m && y) $$('.seg [data-period="year"] small').forEach(el => { const v = Math.round(100 - y / (m * 12) * 100); el.textContent = v > 0 ? `bớt ${v}%` : ''; });
  });
});
