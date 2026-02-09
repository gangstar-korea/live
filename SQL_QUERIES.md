# 통계 대시보드 SQL 쿼리 문서

## 개요
이 문서는 통계 대시보드에서 사용하는 주요 SQL 쿼리들을 정리한 것입니다. Supabase PostgreSQL에서 사용할 수 있습니다.

## 1. 기본 데이터 조회

### 오늘 데이터 조회
```sql
SELECT * FROM access_logs 
WHERE ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day'
ORDER BY ts ASC;
```

### 특정 날짜 데이터 조회
```sql
SELECT * FROM access_logs 
WHERE ts >= '2026-02-10T00:00:00Z' 
  AND ts < '2026-02-11T00:00:00Z'
ORDER BY ts ASC;
```

## 2. 집계 규칙별 쿼리

### 2.1 "접속 수" 기본 집계 (event_type='enter')
```sql
SELECT COUNT(*) as enter_count
FROM access_logs 
WHERE event_type = 'enter'
  AND ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day';
```

### 2.2 "현재 접속중" 사용자 계산
```sql
WITH last_events AS (
  SELECT DISTINCT ON (user_id) 
    user_id, 
    event_type,
    ts,
    name,
    team,
    role
  FROM access_logs 
  WHERE ts >= CURRENT_DATE 
    AND ts < CURRENT_DATE + INTERVAL '1 day'
  ORDER BY user_id, ts DESC
)
SELECT COUNT(*) as current_online
FROM last_events 
WHERE event_type = 'enter';
```

### 2.3 시간대별 접속 집계 (date_trunc 사용)
```sql
SELECT 
  EXTRACT(HOUR FROM ts) as hour,
  COUNT(*) as enter_count
FROM access_logs 
WHERE event_type = 'enter'
  AND ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day'
GROUP BY EXTRACT(HOUR FROM ts)
ORDER BY hour;
```

## 3. 팀별 통계

### 3.1 팀별 현황 종합
```sql
WITH last_events AS (
  SELECT DISTINCT ON (user_id) 
    user_id, 
    event_type,
    name,
    team,
    role,
    env,
    is_mobile,
    leader_mode,
    group_members
  FROM access_logs 
  WHERE ts >= CURRENT_DATE 
    AND ts < CURRENT_DATE + INTERVAL '1 day'
  ORDER BY user_id, ts DESC
),
online_users AS (
  SELECT user_id, name, team, role, env, is_mobile, leader_mode, group_members
  FROM last_events 
  WHERE event_type = 'enter'
),
team_stats AS (
  SELECT 
    team,
    COUNT(*) FILTER (WHERE event_type = 'enter') as total_enters,
    COUNT(*) FILTER (WHERE env = 'internal') as internal_count,
    COUNT(*) FILTER (WHERE is_mobile = true) as mobile_count
  FROM access_logs 
  WHERE ts >= CURRENT_DATE 
    AND ts < CURRENT_DATE + INTERVAL '1 day'
    AND event_type = 'enter'
  GROUP BY team
)
SELECT 
  t.team,
  l.name as leader_name,
  CASE WHEN l.user_id IS NOT NULL THEN '접속중' ELSE '미접속' END as leader_status,
  COUNT(m.user_id) FILTER (WHERE m.user_id IS NOT NULL) as members_online,
  COUNT(m.user_id) as total_members,
  CASE 
    WHEN ts.total_enters > 0 
    THEN ROUND(ts.internal_count::numeric / ts.total_enters * 100, 1) 
    ELSE 0 
  END as internal_ratio,
  CASE 
    WHEN ts.total_enters > 0 
    THEN ROUND(ts.mobile_count::numeric / ts.total_enters * 100, 1) 
    ELSE 0 
  END as mobile_ratio
FROM (SELECT DISTINCT team FROM access_logs) t
LEFT JOIN users l ON l.team = t.team AND l.role = 'leader'
LEFT JOIN online_users l_online ON l.user_id = l_online.user_id
LEFT JOIN users m ON m.team = t.team AND m.role = 'member'
LEFT JOIN online_users m_online ON m.user_id = m_online.user_id
LEFT JOIN team_stats ts ON ts.team = t.team
GROUP BY t.team, l.name, l.user_id, ts.total_enters, ts.internal_count, ts.mobile_count
ORDER BY t.team;
```

### 3.2 팀별 온라인 팀원 계산 (그룹 멤버 포함)
```sql
WITH last_events AS (
  SELECT DISTINCT ON (user_id) 
    user_id, 
    event_type,
    name,
    team,
    role,
    leader_mode,
    group_members
  FROM access_logs 
  WHERE ts >= CURRENT_DATE 
    AND ts < CURRENT_DATE + INTERVAL '1 day'
  ORDER BY user_id, ts DESC
),
individual_online AS (
  SELECT user_id, team, role
  FROM last_events 
  WHERE event_type = 'enter'
),
group_members AS (
  SELECT 
    jsonb_array_elements(group_members)->>'id' as member_id,
    team
  FROM last_events 
  WHERE event_type = 'enter' 
    AND role = 'leader' 
    AND leader_mode = 'group'
    AND group_members IS NOT NULL
),
team_online_counts AS (
  SELECT 
    team,
    COUNT(DISTINCT io.user_id) as individual_count,
    COUNT(DISTINCT gm.member_id) as group_count
  FROM individual_online io
  FULL OUTER JOIN group_members gm ON io.team = gm.team
  GROUP BY team
)
SELECT 
  u.team,
  io.individual_count,
  gm.group_count,
  (io.individual_count + COALESCE(gm.group_count, 0)) as total_online
FROM (SELECT DISTINCT team FROM users) u
LEFT JOIN team_online_counts io ON u.team = io.team
LEFT JOIN team_online_counts gm ON u.team = gm.team;
```

## 4. 필터링된 데이터 조회

### 4.1 역할 필터링
```sql
SELECT * FROM access_logs 
WHERE ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day'
  AND role = 'member'  -- 또는 'leader', 'owner'
ORDER BY ts ASC;
```

### 4.2 환경 필터링
```sql
SELECT * FROM access_logs 
WHERE ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day'
  AND env = 'internal'  -- 또는 'external'
ORDER BY ts ASC;
```

### 4.3 복합 필터링
```sql
SELECT * FROM access_logs 
WHERE ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day'
  AND role = 'member'
  AND env = 'internal'
ORDER BY ts ASC;
```

## 5. 고급 집계 쿼리

### 5.1 Unique 사용자 수 계산
```sql
SELECT COUNT(DISTINCT user_id) as unique_users
FROM access_logs 
WHERE event_type = 'enter'
  AND ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day';
```

### 5.2 모바일 접속 비율
```sql
SELECT 
  COUNT(*) FILTER (WHERE is_mobile = true) as mobile_count,
  COUNT(*) as total_count,
  ROUND(
    COUNT(*) FILTER (WHERE is_mobile = true)::numeric / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) as mobile_ratio
FROM access_logs 
WHERE event_type = 'enter'
  AND ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day';
```

### 5.3 사내/사외 접속 비율
```sql
SELECT 
  COUNT(*) FILTER (WHERE env = 'internal') as internal_count,
  COUNT(*) FILTER (WHERE env = 'external') as external_count,
  COUNT(*) as total_count,
  ROUND(
    COUNT(*) FILTER (WHERE env = 'internal')::numeric / 
    NULLIF(COUNT(*), 0) * 100, 1
  ) as internal_ratio
FROM access_logs 
WHERE event_type = 'enter'
  AND ts >= CURRENT_DATE 
  AND ts < CURRENT_DATE + INTERVAL '1 day';
```

## 6. Supabase REST API 변환

### 6.1 기본 REST API 호출
```
GET /rest/v1/access_logs?ts=gte.2026-02-10T00:00:00Z&ts=lt.2026-02-11T00:00:00Z&order=ts.asc
```

### 6.2 필터링된 REST API 호출
```
GET /rest/v1/access_logs?ts=gte.2026-02-10T00:00:00Z&ts=lt.2026-02-11T00:00:00Z&role=eq.member&env=eq.internal&order=ts.asc
```

### 6.3 집계 REST API 호출
```
GET /rest/v1/access_logs?event_type=eq.enter&ts=gte.2026-02-10T00:00:00Z&ts=lt.2026-02-11T00:00:00Z&select=count
```

## 참고사항

1. **타임존**: 모든 쿼리는 UTC 기준입니다. 한국 시간(KST)을 사용하려면 `AT TIME ZONE 'Asia/Seoul'`을 추가하세요.
2. **성능**: 대용량 데이터의 경우 인덱스를 추가하는 것이 좋습니다:
   ```sql
   CREATE INDEX idx_access_logs_ts ON access_logs(ts);
   CREATE INDEX idx_access_logs_user_id ON access_logs(user_id);
   CREATE INDEX idx_access_logs_event_type ON access_logs(event_type);
   ```
3. **실시간성**: "현재 접속중" 계산은 마지막 이벤트 기준이므로, leave 이벤트가 누락된 경우 부정확할 수 있습니다.
4. **그룹 멤버 중복**: group_members는 JSONB 형식이므로, JSON 함수를 사용하여 처리해야 합니다.
