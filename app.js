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
    USE_SUPABASE: true,
    SUPABASE_URL: "https://iywiojasdpregkuflzzp.supabase.co",          // 예: https://xxxx.supabase.co
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5d2lvamFzZHByZWdrdWZsenpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MjQ0MDAsImV4cCI6MjA4NjIwMDQwMH0.Xr5h-YJULnjaMEpZBLKV4k6KlDVfcnwUd7zHUjwR5hI",     // Settings > API > anon public key

    // Supabase 테이블명(미리 만들어야 함)
    SUPABASE_TABLE: "access_logs"
  };

  async function supabaseReadLogsToday() {
    const start = new Date();
    start.setHours(0,0,0,0);
    const startIso = start.toISOString();

    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.SUPABASE_TABLE}` +
                `?ts=gte.${encodeURIComponent(startIso)}&order=ts.asc`;

    const res = await fetch(url, {
     headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
     }
    });

    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }
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

  function toDbPayload(log) {
  return {
    ts: log.ts,
    event_type: log.event_type,

    user_id: log.user_id,
    loginid: log.loginId ?? log.loginid ?? null,     // ← users.json의 loginId → DB의 loginid
    name: log.name,
    role: log.role,
    team: log.team,
    position: log.position,

    env: log.env,
    is_mobile: log.is_mobile,

    leader_mode: log.leader_mode,
    group_members: log.group_members ?? null
  };
}

  async function supabaseInsertLog(log) {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.SUPABASE_TABLE}`;
  const payload = toDbPayload(log);   // ⭐ 핵심

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": CONFIG.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify([payload])
  });

  if (!res.ok) {
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
/*
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
  } */

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
        // const envMobile = await askEnvAndMobile();

                
        if (user.role === "owner") {
          // 파일럿용: 로컬 통계 기반 프리뷰
          await ownerPreviewCounts(user);
        }

        // 세션 저장
        const sess = {
          // ...envMobile,
          user_id: user.id,
          loginId: user.loginId,
          name: user.name,
          role: user.role,
          team: user.team,
          position: user.position,
          leader_mode: null,
          group_members: [],
          // env/is_mobile은 live에서 입력받을 거라 비워둠
          env: null,
          is_mobile: null
        };
        saveSession(sess);

        // enter 로그
        //await writeLog({
        //  event_type: "enter",
        //  ...sess
        //});

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

  // --- 기본 DOM 참조 ---
  const yt = $("yt");
  const modal = document.getElementById("joinModal");
  const stepEnv = document.getElementById("stepEnv");
  const stepLeader = document.getElementById("stepLeader");
  const memberPicker = document.getElementById("memberPicker");
  const memberList = document.getElementById("memberList");

  const btnEnvNext = document.getElementById("btnEnvNext");
  const btnLeaderBack = document.getElementById("btnLeaderBack");
  const btnLeaderConfirm = document.getElementById("btnLeaderConfirm");

  const btnGroupEdit = document.getElementById("btnGroupEdit");
  const teamOnlineText = document.getElementById("teamOnlineText");

  // 유튜브는 "확인" 이후에만 로드
  if (yt) yt.src = "";

  // 팀장 전용 버튼은 기본 숨김
  if (btnGroupEdit) btnGroupEdit.style.display = "none";
  if (teamOnlineText) teamOnlineText.textContent = "";

  // --- 팀원 목록 준비 (팀장 기능/표시 계산에 사용) ---
  const allUsers = await loadUsers();
  const teamMembers = allUsers.filter(u => u.role === "member" && u.team === sess.team);

    /* ===============================
     담당(owner) 조직 접속 현황
  =============================== */

  const btnOrgStatus = document.getElementById("btnOrgStatus");
  const orgModal = document.getElementById("orgModal");
  const btnOrgClose = document.getElementById("btnOrgClose");
  const orgTbody = document.getElementById("orgTbody");

  // 담당 산하 팀 목록 (leader 중 owner가 나인 팀)
  function getOwnerTeams() {
    return [
      ...new Set(
        allUsers
          .filter(u => u.role === "leader" && u.owner === sess.name)
          .map(u => u.team)
      )
    ];
  }

  function getTeamLeader(team) {
    return allUsers.find(u => u.role === "leader" && u.team === team) || null;
  }

  function getTeamMembers(team) {
    return allUsers.filter(u => u.role === "member" && u.team === team);
  }

  // 오늘 로그 기준 현재 접속자 계산
  function computeOnlineUserSet(logs) {
    const lastByUser = new Map();

    for (const l of logs) {
      if (!l.user_id) continue;
      const prev = lastByUser.get(l.user_id);
      if (!prev || new Date(l.ts) > new Date(prev.ts)) {
        lastByUser.set(l.user_id, l);
      }
    }

    const online = new Set();
    for (const [uid, ev] of lastByUser.entries()) {
      if (ev.event_type === "enter") online.add(uid);
    }
    return online;
  }

  async function refreshOrgStatusTable() {
    if (!orgTbody) return;

    const teams = getOwnerTeams();
    const logs = CONFIG.USE_SUPABASE
      ? await supabaseReadLogsToday()
      : localReadLogsToday();

    const onlineSet = computeOnlineUserSet(logs);
    orgTbody.innerHTML = "";

    for (const team of teams) {
      const leader = getTeamLeader(team);
      const members = getTeamMembers(team);

      const leaderOnline = leader ? onlineSet.has(leader.id) : false;
      const memberOnlineCount = members.filter(m => onlineSet.has(m.id)).length;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${team}</td>
        <td>${leader ? (leaderOnline ? "접속중" : "미접속") : "-"}</td>
        <td>${memberOnlineCount}/${members.length} 접속중</td>
      `;
      orgTbody.appendChild(tr);
    }
  }

  // 담당일 때만 버튼 노출
  if (sess.role === "owner" && btnOrgStatus) {
    btnOrgStatus.style.display = "inline-block";

    btnOrgStatus.onclick = async () => {
      await refreshOrgStatusTable();
      orgModal.style.display = "flex";
    };
  }

  if (btnOrgClose) {
    btnOrgClose.onclick = () => {
      orgModal.style.display = "none";
    };
  }

  // --- "개별 접속 중인 팀원" 계산 (오늘 로그 기반) ---
  function computeOnlineIndividuals(logs) {
    const lastByUser = new Map();
    for (const l of logs) {
      if (!l.user_id) continue;
      // 우리 팀 팀원만
      if (!teamMembers.some(m => m.id === l.user_id)) continue;

      const prev = lastByUser.get(l.user_id);
      if (!prev || new Date(l.ts) > new Date(prev.ts)) lastByUser.set(l.user_id, l);
    }

    const online = new Set();
    for (const [uid, ev] of lastByUser.entries()) {
      if (ev.event_type === "enter") online.add(uid);
    }
    return online;
  }

  let onlineIndividuals = new Set();

  function renderMemberPicker() {
    if (!memberList) return;
    memberList.innerHTML = "";

    for (const m of teamMembers) {
      const disabled = onlineIndividuals.has(m.id); // 이미 개별 접속이면 선택 불가
      const checked = (sess.group_members || []).some(x => x.id === m.id);

      const row = document.createElement("label");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.padding = "6px 0";
      row.style.opacity = disabled ? "0.5" : "1";

      row.innerHTML = `
        <input type="checkbox" data-mid="${m.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <span>${m.name}</span>
      `;
      memberList.appendChild(row);
    }
  }

  // 팀장 그룹에서 "개별 접속된 팀원" 자동 해제
  function dropConflictedMembers() {
    const before = sess.group_members?.length || 0;
    sess.group_members = (sess.group_members || []).filter(x => !onlineIndividuals.has(x.id));
    const after = sess.group_members?.length || 0;

    if (after !== before) {
      saveSession(sess);
      renderMemberPicker();
      $("userCard").textContent = formatUserCard(sess);
    }
  }

  // 우측상단: 현재접속팀원 X/Y
  function updateTeamOnlineText() {
    if (!teamOnlineText) return;

    const total = teamMembers.length;
    const groupEffective = (sess.group_members || []).filter(x => !onlineIndividuals.has(x.id)).length;
    const online = onlineIndividuals.size + groupEffective;

    teamOnlineText.textContent = `현재접속팀원 ${online}/${total}`;
  }

  // 주기적으로 온라인 상태 갱신
  async function refreshOnlineState() {
    const logs = CONFIG.USE_SUPABASE ? await supabaseReadLogsToday() : localReadLogsToday();
    onlineIndividuals = computeOnlineIndividuals(logs);
    dropConflictedMembers();
    renderMemberPicker();
    updateTeamOnlineText();
  }

  // --- 모달 단계 전환 ---
  function openModalToEnvStep() {
    if (!modal) return;
    modal.style.display = "flex";
    stepEnv.style.display = "block";
    stepLeader.style.display = "none";
  }

  function openModalToLeaderStep() {
    if (!modal) return;
    modal.style.display = "flex";
    stepEnv.style.display = "none";
    stepLeader.style.display = "block";
    memberPicker.style.display = "none"; // 기본 숨김
  }

  function setLeaderModeUIFromSession() {
    const mode = sess.leader_mode || "solo";
    document.querySelectorAll('input[name="leaderMode"]').forEach(r => {
      r.checked = (r.value === mode);
    });

    memberPicker.style.display = (mode === "group") ? "block" : "none";
    if (mode === "group") renderMemberPicker();
  }

  // --- 최종 입장 처리: enter 로그 1회 + 카드/영상 로드 ---
  let joined = false;
  let isLeaderEditing = false;  // 추가: 팀장 설정 수정 모드인지


  async function finalizeJoin() {
    // 🔥 수정 모드면 enter/log/영상 건드리지 않는다
  if (joined && isLeaderEditing) {
    // 세션만 반영
    $("userCard").textContent = formatUserCard(sess);
    updateTeamOnlineText();
    modal.style.display = "none";
    isLeaderEditing = false;
    return;
  }
    if (joined) return; // 중복 방지
    joined = true;

    // enter 로그는 여기서 "딱 1번"
    await writeLog({ event_type: "enter", ...sess });

    // 우상단 카드 갱신
    $("userCard").textContent = formatUserCard(sess);
    // 팀원 접속 수 표시 갱신
    updateTeamOnlineText();
    // 영상 로드
    if (yt) {
      yt.src = `https://www.youtube.com/embed/${CONFIG.YOUTUBE_VIDEO_ID}?autoplay=1&mute=1`;
    }

    // 모달 닫기
    if (modal) modal.style.display = "none";
    // 수정 모드 해제
    isLeaderEditing = false;
    // 팀장 전용: 그룹 수정 버튼 + 상태 갱신 루프
    if (sess.role === "leader") {
      if (btnGroupEdit) btnGroupEdit.style.display = "inline-block";
      await refreshOnlineState();
      setInterval(refreshOnlineState, 5000);
    }
  }

  // --- STEP 1: env/mobile ---
  if (btnEnvNext) {
    btnEnvNext.onclick = async () => {
      const env = document.querySelector('input[name="env"]:checked')?.value || "internal";

      const isMobileChk = document.getElementById("isMobileChk");
      const is_mobile = !!(isMobileChk && isMobileChk.checked);

      sess.env = env;
      sess.is_mobile = is_mobile;
      saveSession(sess);

      if (sess.role === "leader") {
        // 팀장만 Step 2로
        openModalToLeaderStep();
        // 멤버 리스트/disabled 반영
        await refreshOnlineState();
        setLeaderModeUIFromSession();
      } else {
        
          // 처음 입장일 때만 enter 로그 찍고 영상 시작
          await finalizeJoin();
        

      }
    };
  }

  // --- STEP 2: 팀장 전용 ---
  // 라디오 변경 시
  document.querySelectorAll('input[name="leaderMode"]').forEach(r => {
    r.onchange = () => {
      const mode = document.querySelector('input[name="leaderMode"]:checked')?.value || "solo";
      sess.leader_mode = mode;

      if (mode === "solo") {
        sess.group_members = [];
        saveSession(sess);
        memberPicker.style.display = "none";
        $("userCard").textContent = formatUserCard(sess);
        updateTeamOnlineText();
      } else {
        saveSession(sess);
        memberPicker.style.display = "block";
        renderMemberPicker();
      }
    };
  });

  if (btnLeaderBack) {
    btnLeaderBack.onclick = () => openModalToEnvStep();
  }

  if (btnLeaderConfirm) {
    btnLeaderConfirm.onclick = async () => {
      const mode = document.querySelector('input[name="leaderMode"]:checked')?.value || "solo";
      sess.leader_mode = mode;

      if (mode === "group") {
        const checks = Array.from(document.querySelectorAll('#memberList input[type="checkbox"]'));
        const selectedIds = checks
          .filter(c => c.checked && !c.disabled)
          .map(c => c.getAttribute("data-mid"));

        sess.group_members = teamMembers
          .filter(m => selectedIds.includes(m.id))
          .map(m => ({ id: m.id, name: m.name }));

        // 혹시 충돌 있으면 자동 해제
        dropConflictedMembers();
      } else {
        sess.group_members = [];
      }

      saveSession(sess);
      await finalizeJoin();
    };
  }

  // --- 팀장 우측 버튼: 같이보기 수정 ---
  if (btnGroupEdit) {
    btnGroupEdit.onclick = async () => {
      
      // 팀장만 의미 있음
      if (sess.role !== "leader") return;
      isLeaderEditing = true;

      openModalToLeaderStep();
      // 현재 세션 상태로 UI 반영
      await refreshOnlineState();
      setLeaderModeUIFromSession();
    };
  }

  // --- 최초 진입: env/mobile 모달 ---
  // (env/is_mobile 이미 값이 있더라도, 파일럿 요구사항대로 "항상 물어보기"면 무조건 띄움)
  openModalToEnvStep();

  // --- userCard는 env 확정 전엔 애매하니, 일단 이름/팀만 보여주고 싶으면 여기서 세팅 가능 ---
  // $("userCard").textContent = `${sess.name} (${sess.team})`;

  // --- 채팅 / 접속자 근사(로컬) / 로그아웃 / leave 로그 --- (기존 코드 유지)
  // userCard는 finalizeJoin에서 세팅하므로 여기서 중복 세팅하지 말 것.

  // 근사 접속자(로컬 기준) - 기존대로 유지
  const updateApprox = () => {
    const el = $("approxOnline");
    if (el) el.textContent = `최근 1분 접속: ${computeApproxOnlineFromLocal()}명`;
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
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const msg = {
      ts: nowISO(),
      user_id: sess.user_id,
      name: sess.name,
      team: sess.team,
      role: sess.role,
      text
    };
    chatChannel.postMessage(msg);
    input.value = "";
  };

  if ($("sendBtn")) $("sendBtn").onclick = send;
  if ($("chatInput")) {
    $("chatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
  }

  // 로그아웃
  if ($("btnLogout")) {
    $("btnLogout").onclick = async (e) => {
      e.preventDefault();
      await safeLeave(sess);
      clearSession();
      location.href = "./index.html";
    };
  }

  // 페이지 이탈(leave 로그) - 최대한 남기기
  window.addEventListener("beforeunload", () => {
    const leaveLog = { event_type: "leave", ...sess, ts: nowISO() };
    localAppendLog(leaveLog);

    if (CONFIG.USE_SUPABASE && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.SUPABASE_TABLE}`, {
        method: "POST",
        headers: {
          "apikey": CONFIG.SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify([toDbPayload(leaveLog)]),
        keepalive: true
      }).catch(()=>{});
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
    // DOM 참조
    const btnRefresh = $("btnRefresh");
    const dateFilter = $("dateFilter");
    const customDate = $("customDate");
    const roleFilter = $("roleFilter");
    const envFilter = $("envFilter");
    const autoRefresh = $("autoRefresh");
    
    // 통계 DOM
    const totalEnters = $("totalEnters");
    const uniqueUsers = $("uniqueUsers");
    const currentOnline = $("currentOnline");
    const mobileRatio = $("mobileRatio");
    const hourlyLoading = $("hourlyLoading");
    const hourlyTable = $("hourlyTable");
    const hourlyBody = $("hourlyBody");
    const teamLoading = $("teamLoading");
    const teamTable = $("teamTable");
    const teamBody = $("teamBody");

    let refreshInterval = null;

    // 날짜 필터 변경 시 커스텀 날짜 입력창 표시/숨김
    dateFilter.onchange = () => {
      if (dateFilter.value === "custom") {
        customDate.style.display = "inline-block";
        customDate.value = new Date().toISOString().slice(0, 10);
      } else {
        customDate.style.display = "none";
      }
    };

    // 날짜 범위 가져오기
    function getDateRange() {
      const now = new Date();
      let start, end;
      
      if (dateFilter.value === "today") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      } else if (dateFilter.value === "yesterday") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (dateFilter.value === "custom" && customDate.value) {
        start = new Date(customDate.value + "T00:00:00");
        end = new Date(customDate.value + "T23:59:59");
      } else {
        // 기본: 오늘
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      }
      
      return { start: start.toISOString(), end: end.toISOString() };
    }

    // Supabase에서 로그 읽기 (날짜 범위 및 필터 적용)
    async function supabaseReadLogsFiltered() {
      const { start, end } = getDateRange();
      let url = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.SUPABASE_TABLE}?ts=gte.${encodeURIComponent(start)}&ts=lt.${encodeURIComponent(end)}&order=ts.asc`;
      
      // 역할 필터
      if (roleFilter.value) {
        url += `&role=eq.${roleFilter.value}`;
      }
      
      // 환경 필터
      if (envFilter.value) {
        url += `&env=eq.${envFilter.value}`;
      }

      const res = await fetch(url, {
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
        }
      });

      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    }

    // 로컬 스토리지에서 로그 읽기 (필터 적용)
    function localReadLogsFiltered() {
      const { start, end } = getDateRange();
      const logs = localReadLogsToday();
      
      return logs.filter(log => {
        const logTime = new Date(log.ts).getTime();
        const startTime = new Date(start).getTime();
        const endTime = new Date(end).getTime();
        
        if (logTime < startTime || logTime >= endTime) return false;
        if (roleFilter.value && log.role !== roleFilter.value) return false;
        if (envFilter.value && log.env !== envFilter.value) return false;
        
        return true;
      });
    }

    // 현재 접속자 계산 (집계 규칙 2, 3 적용)
    function computeCurrentOnline(logs, users) {
      const lastByUser = new Map();
      
      // 각 사용자의 마지막 이벤트 찾기
      for (const l of logs) {
        if (!l.user_id) continue;
        const prev = lastByUser.get(l.user_id);
        if (!prev || new Date(l.ts) > new Date(prev.ts)) {
          lastByUser.set(l.user_id, l);
        }
      }

      const online = new Set();
      const groupMembers = new Set(); // 팀장이 group으로 체크한 멤버
      
      // 개별 접속자 찾기
      for (const [uid, ev] of lastByUser.entries()) {
        if (ev.event_type === "enter") {
          online.add(uid);
          
          // 팀장이 group 모드인 경우 group_members 추가
          if (ev.role === "leader" && ev.leader_mode === "group" && ev.group_members) {
            ev.group_members.forEach(member => {
              groupMembers.add(member.id);
            });
          }
        }
      }

      // 개별 접속자와 그룹 멤버 중복 제거
      const finalOnline = new Set(online);
      for (const memberId of groupMembers) {
        if (!online.has(memberId)) {
          finalOnline.add(memberId);
        }
      }

      return finalOnline;
    }

    // 팀별 통계 계산
    function computeTeamStats(logs, users, onlineUsers) {
      const teams = [...new Set(users.map(u => u.team))];
      const stats = {};

      for (const team of teams) {
        const teamUsers = users.filter(u => u.team === team);
        const leader = teamUsers.find(u => u.role === "leader");
        const members = teamUsers.filter(u => u.role === "member");
        
        // 팀장 온라인 여부
        const leaderOnline = leader ? onlineUsers.has(leader.id) : false;
        
        // 팀원 온라인 계산 (개별 + 그룹)
        let memberOnlineCount = 0;
        let internalCount = 0;
        let mobileCount = 0;
        let totalAccessCount = 0;

        // 팀별 로그 필터링
        const teamLogs = logs.filter(l => l.team === team);
        const enterLogs = teamLogs.filter(l => l.event_type === "enter");

        // 온라인 팀원 계산
        for (const member of members) {
          if (onlineUsers.has(member.id)) {
            memberOnlineCount++;
          }
        }

        // 접속 환경 및 모바일 통계
        for (const log of enterLogs) {
          totalAccessCount++;
          if (log.env === "internal") internalCount++;
          if (log.is_mobile) mobileCount++;
        }

        const internalRatio = totalAccessCount > 0 ? (internalCount / totalAccessCount * 100).toFixed(1) : "0.0";
        const mobileRatio = totalAccessCount > 0 ? (mobileCount / totalAccessCount * 100).toFixed(1) : "0.0";

        stats[team] = {
          leader: leader ? { name: leader.name, online: leaderOnline } : null,
          memberOnline: memberOnlineCount,
          memberTotal: members.length,
          internalRatio: internalRatio + "%",
          mobileRatio: mobileRatio + "%"
        };
      }

      return stats;
    }

    // 시간대별 집계
    function computeHourlyStats(logs) {
      const enter = logs.filter(l => l.event_type === "enter");
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const counts = {};
      
      for (const h of hours) counts[h] = 0;

      for (const l of enter) {
        const d = new Date(l.ts);
        const h = d.getHours();
        counts[h] = (counts[h] || 0) + 1;
      }

      return counts;
    }

    // UI 렌더링 함수들
    function renderSummary(logs, onlineUsers) {
      const enterLogs = logs.filter(l => l.event_type === "enter");
      const uniqueUsers = new Set(enterLogs.map(l => l.user_id));
      const mobileCount = enterLogs.filter(l => l.is_mobile).length;
      const mobileRatio = enterLogs.length > 0 ? (mobileCount / enterLogs.length * 100).toFixed(1) : "0.0";

      totalEnters.textContent = enterLogs.length.toLocaleString();
      uniqueUsers.textContent = uniqueUsers.size.toLocaleString();
      currentOnline.textContent = onlineUsers.size.toLocaleString();
      mobileRatio.textContent = mobileRatio + "%";
    }

    function renderHourly(counts) {
      hourlyBody.innerHTML = "";
      const maxCount = Math.max(...Object.values(counts), 1);

      for (let h = 0; h < 24; h++) {
        const count = counts[h] || 0;
        const widthPercent = (count / maxCount * 100).toFixed(1);
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${String(h).padStart(2, "0")}시</td>
          <td class="hourly-count">${count}</td>
          <td class="hourly-cell">
            <div class="hourly-bar" style="width: ${widthPercent}%;"></div>
          </td>
        `;
        hourlyBody.appendChild(tr);
      }

      hourlyLoading.style.display = "none";
      hourlyTable.style.display = "table";
    }

    function renderTeams(teamStats) {
      teamBody.innerHTML = "";
      
      for (const [team, stats] of Object.entries(teamStats)) {
        const tr = document.createElement("tr");
        const leaderStatus = stats.leader 
          ? `<span class="${stats.leader.online ? 'online' : 'offline'}">${stats.leader.online ? '접속중' : '미접속'}</span>`
          : '-';
        
        tr.innerHTML = `
          <td>${team}</td>
          <td>${leaderStatus}</td>
          <td>${stats.memberOnline}/${stats.memberTotal} 접속중</td>
          <td>${stats.internalRatio}</td>
          <td>${stats.mobileRatio}</td>
        `;
        teamBody.appendChild(tr);
      }

      teamLoading.style.display = "none";
      teamTable.style.display = "table";
    }

    // 메시지 로드 및 렌더링
    async function loadAndRenderData() {
      try {
        // 로딩 표시
        hourlyLoading.style.display = "block";
        hourlyTable.style.display = "none";
        teamLoading.style.display = "block";
        teamTable.style.display = "none";

        // 데이터 로드
        const logs = CONFIG.USE_SUPABASE ? await supabaseReadLogsFiltered() : localReadLogsFiltered();
        const users = await loadUsers();
        
        // 통계 계산
        const onlineUsers = computeCurrentOnline(logs, users);
        const teamStats = computeTeamStats(logs, users, onlineUsers);
        const hourlyStats = computeHourlyStats(logs);

        // UI 렌더링
        renderSummary(logs, onlineUsers);
        renderHourly(hourlyStats);
        renderTeams(teamStats);

      } catch (error) {
        console.error("데이터 로딩 실패:", error);
        hourlyLoading.textContent = "데이터 로딩 실패";
        teamLoading.textContent = "데이터 로딩 실패";
      }
    }

    // 자동 새로고침 설정
    function setupAutoRefresh() {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }

      if (autoRefresh.checked) {
        refreshInterval = setInterval(loadAndRenderData, 10000); // 10초
      }
    }

    // 이벤트 리스너
    btnRefresh.onclick = loadAndRenderData;
    dateFilter.onchange = loadAndRenderData;
    customDate.onchange = loadAndRenderData;
    roleFilter.onchange = loadAndRenderData;
    envFilter.onchange = loadAndRenderData;
    autoRefresh.onchange = setupAutoRefresh;

    // 초기 로드
    await loadAndRenderData();
    setupAutoRefresh();
  }

  return {
    initLoginPage,
    initLivePage,
    initStatsPage
  };
})();
