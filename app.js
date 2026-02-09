/* ==========
  PilotApp: GitHub Pages용 초간단 파일럿
  - users.json 기반 가짜 로그인
  - env/internal-external + mobile 체크
  - leader: solo/group + 그룹 멤버 체크
  - owner: (파일럿) 오늘 누적 enter 기준 팀별 카운트 미리보기
  - live: 유튜브 임베드 + 탭간 채팅(BroadcastChannel)
  - 통계: 시간대별 enter 집계
========== */

const PilotApp = (() => {
  // ===== 설정 =====
  const CONFIG = {
    // 유튜브 영상 ID만 바꾸면 됨 (가짜 라이브)
    YOUTUBE_VIDEO_ID: "dQw4w9WgXcQ",

    // 통계 로그 저장소
    // 1) 기본: 브라우저 localStorage (데모/개발 편함)
    // 2) 선택: Supabase REST 연동 (전사원이 서로 다른 PC에서 접속해도 집계 가능)
    USE_SUPABASE: false,
    SUPABASE_URL: "",          // 예: https://xxxx.supabase.co
    SUPABASE_ANON_KEY: "",     // Settings > API > anon public key

    // Supabase 테이블명(미리 만들어야 함)
    SUPABASE_TABLE: "access_logs"
  };

  // ===== 유틸 =====
  const $ = (id) => document.getElementById(id);
  const nowISO = () => new Date().toISOString();
  const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  function isMobileUA() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  function saveSession(obj) {
    sessionStorage.setItem("pilot_session", JSON.stringify(obj));
  }
  function loadSession() {
    const raw = sessionStorage.getItem("pilot_session");
    return raw ? JSON.parse(raw) : null;
  }
  function clearSession() {
    sessionStorage.removeItem("pilot_session");
  }

  // ===== 로그 저장(로컬 or Supabase) =====
  function localAppendLog(log) {
    const k = `pilot_logs_${todayKey()}`;
    const arr = JSON.parse(localStorage.getItem(k) || "[]");
    arr.push(log);
    localStorage.setItem(k, JSON.stringify(arr));
  }
  function localReadLogsToday() {
    const k = `pilot_logs_${todayKey()}`;
    return JSON.parse(localStorage.getItem(k) || "[]");
  }

  async function supabaseInsertLog(log) {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.SUPABASE_TABLE}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": CONFIG.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify([log])
    });
    if (!res.ok) {
      // Supabase 설정 안되면 파일럿 중단 안되게 로컬로 백업
      console.warn("Supabase insert failed, fallback to local", await res.text());
      localAppendLog({ ...log, _note: "fallback_local" });
    }
  }

  async function writeLog(log) {
    // 공통 보강
    log.ts = log.ts || nowISO();
    log.client = {
      uaMobile: isMobileUA(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown"
    };

    if (CONFIG.USE_SUPABASE && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
      await supabaseInsertLog(log);
    } else {
      localAppendLog(log);
    }
  }

  // ===== users.json 로딩 + 로그인 =====
  async function loadUsers() {
    const res = await fetch("./users.json", { cache: "no-store" });
    if (!res.ok) throw new Error("users.json 로딩 실패");
    const data = await res.json();
    return data.users || [];
  }

  async function loginWithJson(loginId, password) {
    const users = await loadUsers();
    const u = users.find(x => x.loginId === loginId && x.password === password);
    if (!u) return null;
    return u;
  }

  // ===== 모달(간단 prompt 기반) =====
  async function askEnvAndMobile() {
    // 사내/사외
    const env = confirm("사내 접속이면 [확인], 사외 접속이면 [취소]") ? "internal" : "external";
    // 모바일 체크(사용자 입력 우선)
    const mobile = confirm("모바일로 접속했으면 [확인], 아니면 [취소]");
    return { env, is_mobile: mobile };
  }

  async function askLeaderModeAndMembers(user) {
    const isGroup = confirm("팀원들과 같이 보는 경우 [확인], 혼자 보면 [취소]");
    const leader_mode = isGroup ? "group" : "solo";
    let group_members = [];
    if (isGroup) {
      const users = await loadUsers();
      const members = users.filter(x => x.role === "member" && x.team === user.team);
      // 간단 체크: prompt에 id 목록 입력 방식(개발 가장 빠름)
      const list = members.map(m => `${m.id}:${m.name}`).join(", ");
      const input = prompt(
        `같이 보는 팀원을 선택하세요.\n아래 목록에서 ID만 쉼표로 입력\n예) u001,u002\n\n목록: ${list}`,
        ""
      );
      if (input && input.trim()) {
        const ids = input.split(",").map(s => s.trim()).filter(Boolean);
        group_members = members.filter(m => ids.includes(m.id)).map(m => ({ id: m.id, name: m.name }));
      }
    }
    return { leader_mode, group_members };
  }

  async function ownerPreviewCounts(ownerUser) {
    // 파일럿: "오늘 enter 누적" 기준으로 팀별 접속수 보여주기
    const logs = localReadLogsToday().filter(l => l.event_type === "enter");
    // 담당 산하 팀: users.json에서 owner 이름 매칭
    const users = await loadUsers();
    const teams = [...new Set(users.filter(u => u.owner === ownerUser.name).map(u => u.team))];

    const counts = {};
    for (const t of teams) counts[t] = 0;
    for (const l of logs) {
      if (teams.includes(l.team)) counts[l.team] = (counts[l.team] || 0) + 1;
    }

    const lines = teams.map(t => `- ${t}: ${counts[t] || 0}명 (오늘 enter 누적)`).join("\n");
    alert(`담당 산하 팀별 접속(파일럿 기준)\n\n${lines}\n\n[확인] 누르면 라이브로 이동합니다.`);
  }

  // ===== Live 페이지 UI =====
  const chatChannel = new BroadcastChannel("pilot_chat");
  function appendChatMessage(msg) {
    const box = $("chatBox");
    const p = document.createElement("p");
    p.className = "msg";
    p.innerHTML = `<div><strong>${escapeHtml(msg.name)}</strong> <span class="meta">(${escapeHtml(msg.team)} · ${escapeHtml(msg.role)})</span></div>
                   <div>${escapeHtml(msg.text)}</div>
                   <div class="meta">${new Date(msg.ts).toLocaleTimeString()}</div>`;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
    }[m]));
  }

  function computeApproxOnlineFromLocal() {
    // "최근 1분 내 enter"를 근사 접속자수로 표시(파일럿용)
    const logs = localReadLogsToday().filter(l => l.event_type === "enter");
    const now = Date.now();
    const recent = logs.filter(l => (now - new Date(l.ts).getTime()) <= 60 * 1000);
    // user_id 기준 유니크
    const uniq = new Set(recent.map(r => r.user_id));
    return uniq.size;
  }

  function formatUserCard(sess) {
    const mobileIcon = sess.is_mobile ? "📱" : "";
    const env = sess.env === "internal" ? "사내" : "사외";

    let extra = "";
    if (sess.role === "leader") {
      const cnt = (sess.group_members?.length || 0);
      extra = sess.leader_mode === "group" ? ` · 같이보기 ${cnt}명 체크` : " · 혼자보기";
    }
    if (sess.role === "owner") {
      extra = " · 담당";
    }

    return `${mobileIcon} ${sess.name} (${sess.team}) · ${env}${extra}`;
  }

  // ===== 페이지별 init =====
  async function initLoginPage() {
    const btn = $("btnLogin");
    const err = $("err");

    btn.onclick = async () => {
      err.textContent = "";
      btn.disabled = true;
      try {
        const loginId = $("loginId").value.trim();
        const password = $("password").value.trim();
        if (!loginId || !password) {
          err.textContent = "아이디/비밀번호를 입력하세요.";
          return;
        }

        const user = await loginWithJson(loginId, password);
        if (!user) {
          err.textContent = "로그인 실패: users.json 정보를 확인하세요.";
          return;
        }

        // 1) env/mobile
        const envMobile = await askEnvAndMobile();

        // 2) role 분기
        let leader_mode = null;
        let group_members = [];
        if (user.role === "leader") {
          const m = await askLeaderModeAndMembers(user);
          leader_mode = m.leader_mode;
          group_members = m.group_members;
        }
        if (user.role === "owner") {
          // 파일럿용: 로컬 통계 기반 프리뷰
          await ownerPreviewCounts(user);
        }

        // 세션 저장
        const sess = {
          ...envMobile,
          user_id: user.id,
          loginId: user.loginId,
          name: user.name,
          role: user.role,
          team: user.team,
          position: user.position,
          leader_mode,
          group_members
        };
        saveSession(sess);

        // enter 로그
        await writeLog({
          event_type: "enter",
          ...sess
        });

        // 이동
        location.href = "./live.html";
      } catch (e) {
        console.error(e);
        err.textContent = "에러 발생: 콘솔을 확인하세요.";
      } finally {
        btn.disabled = false;
      }
    };
  }

  async function initLivePage() {
    const sess = loadSession();
    if (!sess) {
      alert("세션이 없습니다. 로그인 페이지로 이동합니다.");
      location.href = "./index.html";
      return;
    }

    // 유튜브 임베드
    const yt = $("yt");
    yt.src = `https://www.youtube.com/embed/${CONFIG.YOUTUBE_VIDEO_ID}?autoplay=1&mute=1`;

    // 우상단 카드
    $("userCard").textContent = formatUserCard(sess);

    // 근사 접속자
    const updateApprox = () => {
      $("approxOnline").textContent = `최근 1분 접속: ${computeApproxOnlineFromLocal()}명`;
    };
    updateApprox();
    setInterval(updateApprox, 5000);

    // 채팅 수신
    chatChannel.onmessage = (ev) => {
      appendChatMessage(ev.data);
    };

    // 채팅 전송
    const send = () => {
      const input = $("chatInput");
      const text = input.value.trim();
      if (!text) return;
      const msg = { ts: nowISO(), user_id: sess.user_id, name: sess.name, team: sess.team, role: sess.role, text };
      chatChannel.postMessage(msg);
      input.value = "";
    };
    $("sendBtn").onclick = send;
    $("chatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });

    // 로그아웃
    $("btnLogout").onclick = async (e) => {
      e.preventDefault();
      await safeLeave(sess);
      clearSession();
      location.href = "./index.html";
    };

    // 페이지 이탈(leave 로그) - 최대한 남기기
    window.addEventListener("beforeunload", () => {
      // fetch는 막힐 수 있어서 local은 즉시 기록, supabase는 best-effort
      // (파일럿이라 과감히)
      const leaveLog = { event_type: "leave", ...sess, ts: nowISO() };
      localAppendLog(leaveLog);

      if (CONFIG.USE_SUPABASE && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
        const url = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.SUPABASE_TABLE}`;
        const blob = new Blob([JSON.stringify([leaveLog])], { type: "application/json" });
        navigator.sendBeacon(url, blob); // 헤더 제한 있음(완벽X) → 파일럿용
      }
    });
  }

  async function safeLeave(sess) {
    try {
      await writeLog({ event_type: "leave", ...sess });
    } catch (e) {
      console.warn("leave log failed", e);
    }
  }

  async function initStatsPage() {
    const btn = $("btnRefresh");
    const tbody = $("tbody");

    function renderHourly(logs) {
      const enter = logs.filter(l => l.event_type === "enter");
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const counts = {};
      for (const h of hours) counts[h] = 0;

      for (const l of enter) {
        const d = new Date(l.ts);
        const h = d.getHours();
        counts[h] = (counts[h] || 0) + 1;
      }

      tbody.innerHTML = "";
      for (const h of hours) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${String(h).padStart(2, "0")}시</td><td>${counts[h] || 0}</td>`;
        tbody.appendChild(tr);
      }
    }

    btn.onclick = () => {
      const logs = localReadLogsToday();
      renderHourly(logs);
    };

    // 첫 로드
    btn.click();
  }

  return {
    initLoginPage,
    initLivePage,
    initStatsPage
  };
})();
