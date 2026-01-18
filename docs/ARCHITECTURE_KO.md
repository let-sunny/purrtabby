# purrtabby 아키텍처 문서

## 목차

1. [개요](#개요)
2. [핵심 설계 원칙](#핵심-설계-원칙)
3. [모듈 구조](#모듈-구조)
4. [TabBus 아키텍처](#tabbus-아키텍처)
5. [리더 선출 아키텍처](#리더-선출-아키텍처)
6. [제너레이터 기반 스트림](#제너레이터-기반-스트림)
7. [데이터 흐름](#데이터-흐름)
8. [설계 결정](#설계-결정)
9. [성능 고려사항](#성능-고려사항)
10. [결론](#결론)
11. [부록: 리더 선출 알고리즘 상세 설명](#부록-리더-선출-알고리즘-상세-설명)

---

## 개요

purrtabby는 브라우저 환경에서 탭 간 통신과 리더 선출을 위한 경량 라이브러리입니다. BroadcastChannel을 사용하여 탭 간 메시징을 제공하고, localStorage를 사용하여 하트비트 기반 리스(lease) 메커니즘으로 리더 선출을 구현합니다.

### 주요 기능

- **경량**: 7KB 미만 (gzip 압축 시 약 3KB)
- **탭 간 통신**: BroadcastChannel 기반 pub-sub 메시징
- **리더 선출**: 하트비트 메커니즘을 가진 localStorage 기반 리스
- **비동기 이터러블**: 제너레이터 기반 메시지 및 이벤트 스트림
- **타입 안정성**: 완전한 TypeScript 지원
- **의존성 없음**: 네이티브 브라우저 API만 사용 (BroadcastChannel, localStorage)

---

## 핵심 설계 원칙

### 1. 함수형 프로그래밍 접근

테스트 가능성과 유지보수성을 향상시키기 위해 순수 함수를 사용하는 함수형 프로그래밍 스타일을 채택했습니다.

**함수형을 선택한 이유?**

- **순수 함수**: 핵심 로직이 상태를 매개변수로 받는 순수 함수로 구현됨
  - `handleBusMessage()`: 들어오는 메시지 처리
  - `handleBusMessageEvent()`: 에러 처리를 포함한 BroadcastChannel 이벤트 처리
  - `tryAcquireLeadership()`: 리더십 획득 시도
  - `sendLeaderHeartbeat()`: 리더십 유지를 위한 하트비트 전송
  - `checkLeaderLeadership()`: 현재 리더십 상태 확인
- **테스트 가능성**: 순수 함수는 독립적으로 테스트하기 쉬움
- **숨겨진 상태 없음**: 모든 의존성이 명시적 매개변수로 전달됨
- **구성 가능성**: 함수를 쉽게 조합하고 재사용할 수 있음

### 2. 이벤트 기반 아키텍처

모든 상태 변경이 이벤트로 추적되어 투명성과 디버깅 용이성을 보장합니다.

### 3. 제너레이터 기반 스트림

메시지와 이벤트가 비동기 이터러블을 사용하여 스트림으로 처리되어 깔끔한 async/await 패턴을 사용할 수 있습니다.

---

## 모듈 구조

```
src/
├── index.ts          # 공개 API 진입점
├── bus.ts            # TabBus 구현
├── leader.ts         # LeaderElector 구현
├── generators.ts      # 비동기 이터러블 제너레이터
├── utils.ts          # 유틸리티 함수 (ID 생성, 이벤트 생성, localStorage 헬퍼)
└── types.ts          # TypeScript 타입 정의
```

### 모듈 책임

#### `index.ts`
- 공개 API 내보내기: `createBus()`, `createLeaderElector()`
- TypeScript 사용자를 위한 타입 재내보내기

#### `bus.ts`
- `createBus()`: TabBus 인스턴스를 생성하는 팩토리 함수
- `handleBusMessage()`: 들어오는 메시지를 처리하는 순수 함수
- `handleBusMessageEvent()`: BroadcastChannel 이벤트를 처리하는 순수 함수
- publish/subscribe/stream API를 가진 TabBus 구현

#### `leader.ts`
- `createLeaderElector()`: LeaderElector 인스턴스를 생성하는 팩토리 함수
- `tryAcquireLeadership()`: 리더십 획득을 시도하는 순수 함수
- `sendLeaderHeartbeat()`: 하트비트를 전송하는 순수 함수
- `checkLeaderLeadership()`: 리더십 상태를 확인하는 순수 함수
- `emitLeaderEvent()`: 리더 이벤트를 발생시키는 순수 함수
- start/stop/stream API를 가진 LeaderElector 구현

#### `generators.ts`
- `busMessagesGenerator()`: TabBus 메시지용 비동기 제너레이터
- `leaderEventsGenerator()`: 리더 이벤트용 비동기 제너레이터

#### `utils.ts`
- `generateTabId()`: 고유한 탭 식별자 생성
- `createTabBusEvent()`: TabBus 이벤트 객체 생성
- `createLeaderEvent()`: 리더 이벤트 객체 생성
- `addJitter()`: 값에 지터 추가
- `waitForItems()`: 이벤트 기반 알림을 사용하여 항목 대기
- `readLeaderLease()`, `writeLeaderLease()`, `removeLeaderLease()`: localStorage 헬퍼
- `isValidLeaderLease()`: 리더 리스 검증

#### `types.ts`
- 모든 공개 및 내부 API에 대한 TypeScript 인터페이스 및 타입

---

## TabBus 아키텍처

### 핵심 구성 요소

1. **BroadcastChannel**: 탭 간 통신을 위한 네이티브 브라우저 API
2. **메시지 큐**: 스트림 제너레이터를 위한 메시지를 버퍼링하는 배열
3. **콜백**: 타입별 및 전체 메시지 구독을 위한 Map 기반 콜백 저장소
4. **리졸버**: 대기 중인 제너레이터에 알리기 위한 Promise 리졸버 세트

### 메시지 흐름

```
메시지 발행
    ↓
BroadcastChannel.postMessage()
    ↓
다른 탭들이 BroadcastChannel.onmessage로 수신
    ↓
handleBusMessageEvent() (에러 처리 포함)
    ↓
handleBusMessage() (순수 함수)
    ↓
├─→ 타입별 콜백
├─→ 전체 메시지 콜백
└─→ 메시지 큐 (스트림 제너레이터용)
    ↓
    리졸버를 통해 대기 중인 제너레이터에 알림
```

### 주요 함수

#### `handleBusMessage()`
메시지를 처리하는 순수 함수:
- 타입별 콜백에 알림
- 전체 메시지 콜백에 알림
- 스트림 제너레이터를 위한 메시지를 큐에 추가
- 대기 중인 제너레이터 해결

#### `handleBusMessageEvent()`
BroadcastChannel 메시지 이벤트를 처리하는 순수 함수:
- 이벤트에서 메시지 파싱
- 에러 처리를 포함하여 `handleBusMessage()` 호출
- 파싱 실패 시 에러 이벤트 발생

### 자체 메시지 처리

기본적으로 `BroadcastChannel`은 메시지를 보낸 탭에 전달하지 않습니다. 모든 탭이 동일한 코드를 사용하는 리더-팔로워 패턴을 지원하기 위해 `queueMicrotask()`를 사용하여 자체 메시지에 대해 `handleBusMessage()`를 다음 마이크로태스크로 지연 실행합니다.

---

## 리더 선출 아키텍처

### 핵심 구성 요소

1. **localStorage**: tabId, 타임스탬프, 리스 지속 시간을 가진 리더 리스 저장
2. **하트비트 타이머**: 주기적으로 리스를 업데이트하는 간격 타이머
3. **체크 타이머**: 리더십 변경을 폴링하는 간격 타이머
4. **이벤트 큐**: 스트림 제너레이터를 위한 이벤트를 버퍼링하는 배열
5. **콜백**: 타입별 및 전체 이벤트 구독을 위한 Map 기반 콜백 저장소

### 리더 리스 구조

**리스(Lease)란 무엇인가?**

**리스(lease)**는 탭에게 리더가 될 권리를 부여하는 시간 제한 "계약"입니다. 아파트를 임대하는 것과 비슷합니다:
- 리스에는 만료 시간이 있습니다
- 리더는 리더십을 유지하기 위해 주기적으로 리스를 갱신해야 합니다 (하트비트를 통해)
- 리스가 만료되면 어떤 탭이든 리더십을 획득할 수 있습니다
- 이를 통해 리더 탭이 크래시하거나 닫히면 다른 탭이 자동으로 인수할 수 있습니다

```typescript
interface LeaderLease {
  tabId: string;      // 리더 탭의 ID
  timestamp: number;   // 리스가 생성/업데이트된 시점
  leaseMs: number;     // 밀리초 단위의 리스 지속 시간
}
```

리스는 `localStorage`에 저장되며 다음을 포함합니다:
- **tabId**: 현재 리더인 탭
- **timestamp**: 리스가 마지막으로 업데이트된 시간 (만료 계산에 사용)
- **leaseMs**: 리스가 유효한 기간 (기본값: 5000ms = 5초)

리스는 다음 경우에 **만료**된 것으로 간주됩니다: `timestamp + leaseMs < Date.now()`

### 선출 흐름

```
선출 시작
    ↓
tryAcquireLeadership()
    ↓
리스가 존재하고 유효한지 확인
    ↓
리스가 없거나 만료된 경우:
    ├─→ localStorage에 새 리스 작성
    ├─→ isLeader = true 설정
    └─→ 'acquire' 이벤트 발생
    ↓
하트비트 타이머 시작
    ↓
주기적으로 하트비트 전송 (sendLeaderHeartbeat)
    ↓
localStorage에서 리스 타임스탬프 업데이트
```

### 하트비트 메커니즘

리더는 주기적으로 리스 타임스탬프를 업데이트하여 리더십을 유지합니다:

```typescript
// 매 heartbeatMs 밀리초마다
sendLeaderHeartbeat() {
  if (isLeader && 리스가 여전히 유효함) {
    writeLeaderLease() // 타임스탬프 업데이트
  } else {
    // 리더십 상실
    emitLeaderEvent('lose')
  }
}
```

### 리더십 확인

비리더 탭은 주기적으로 리더십 변경을 확인합니다:

```typescript
// 매 checkInterval 밀리초마다
checkLeaderLeadership() {
  const currentLease = readLeaderLease()
  
  if (currentLease가 유효하고 currentLease.tabId === this.tabId) {
    // 우리가 리더임
    if (!wasLeader) {
      emitLeaderEvent('acquire')
    }
  } else if (wasLeader) {
    // 리더십 상실
    emitLeaderEvent('lose')
  } else if (currentLease?.tabId !== this.tabId) {
    // 다른 탭으로 리더십 변경
    emitLeaderEvent('change')
  }
}
```

### 주요 함수

#### `tryAcquireLeadership()`
리더십 획득을 시도하는 순수 함수:
- localStorage에서 현재 리스 읽기
- 리스가 없거나 만료된 경우 새 리스 작성
- 리더십이 획득되면 true 반환

#### `sendLeaderHeartbeat()`
하트비트를 전송하는 순수 함수:
- 여전히 리더인지 확인
- 유효한 경우 리스 타임스탬프 업데이트
- 리더십이 상실된 경우 'lose' 이벤트 발생

#### `checkLeaderLeadership()`
리더십 상태를 확인하는 순수 함수:
- 현재 리스 읽기
- 자신의 tabId와 비교
- 적절한 이벤트 발생 ('acquire', 'lose', 'change')

---

## 제너레이터 기반 스트림

### 메시지 스트림 제너레이터

```typescript
async function* busMessagesGenerator(state, queue, signal?) {
  state.activeIterators++;
  try {
    while (true) {
      // 버퍼링된 메시지 yield
      while (queue.messages.length > 0) {
        yield queue.messages.shift()!;
      }
      
      // 새 메시지 대기
      await waitForItems(signal, ...);
    }
  } finally {
    state.activeIterators--;
    // 마지막 이터레이터가 종료될 때 큐 정리
    if (state.activeIterators === 0) {
      queue.messages = [];
    }
  }
}
```

### 이벤트 스트림 제너레이터

리더 이벤트에 대해서도 유사한 구조이지만 메시지 큐 대신 이벤트 큐를 사용합니다.

### 대기 메커니즘

`waitForItems()`는 이벤트 기반 알림 시스템을 사용합니다:
- 대기 시 리졸버를 Set에 추가
- 항목이 도착하면 해결 (via `forEach(resolve)`)
- 중단 또는 항목 도착 시 리졸버 정리
- 취소를 위한 AbortSignal 지원

### 다중 이터레이터

여러 이터레이터가 동일한 스트림에서 소비할 수 있습니다:
- 각 이터레이터가 `activeIterators`를 증가시킴
- 메시지/이벤트는 읽는 첫 번째 이터레이터가 소비함
- 큐는 마지막 이터레이터가 종료될 때만 정리됨

---

## 데이터 흐름

### TabBus 메시지 흐름

```
탭 A: bus.publish('type', payload)
    ↓
BroadcastChannel.postMessage({ type, payload, tabId, ts })
    ↓
탭 B: BroadcastChannel.onmessage
    ↓
handleBusMessageEvent(event)
    ↓
handleBusMessage(message)
    ↓
├─→ bus.subscribe('type', callback) → callback(message)
├─→ bus.subscribeAll(callback) → callback(message)
└─→ bus.stream() → yield message
```

### 리더 선출 흐름

```
탭 A: leader.start()
    ↓
tryAcquireLeadership()
    ↓
localStorage에 리스 작성
    ↓
'acquire' 이벤트 발생
    ↓
하트비트 타이머 시작
    ↓
주기적으로: sendLeaderHeartbeat()
    ↓
리스 타임스탬프 업데이트
    ↓
탭 B: checkLeaderLeadership()
    ↓
localStorage에서 리스 읽기
    ↓
'change' 이벤트 발생 (다른 리더인 경우)
```

---

## 설계 결정

### 1. 클래스 기반 대신 함수형을 선택한 이유?

- **테스트 가능성**: 순수 함수는 독립적으로 테스트하기 쉬움
- **단순성**: `this` 컨텍스트 관리 불필요
- **구성 가능성**: 함수를 쉽게 조합할 수 있음
- **경량**: 클래스보다 오버헤드가 적음

### 2. 순수 함수를 사용하는 이유?

- **명시적 의존성**: 모든 의존성이 매개변수로 전달됨
- **숨겨진 상태 없음**: 상태가 명시적으로 관리됨
- **테스트 용이성**: 모의 상태로 함수 테스트 가능
- **더 나은 커버리지**: 에러 경로와 엣지 케이스를 직접 테스트 가능

### 3. 자체 메시지를 허용하는 이유?

- **일관성**: 모든 탭이 동일한 코드 사용
- **리더-팔로워 패턴**: 리더가 자신의 메시지를 처리할 수 있음
- **단순한 로직**: 어디서나 `if (!leader.isLeader())` 체크 불필요

### 4. 리더 선출에 localStorage를 사용하는 이유?

- **지속성**: 페이지 새로고침 후에도 유지됨
- **크로스 탭 가시성**: 모든 탭이 읽기/쓰기 가능
- **단순함**: 복잡한 조정 프로토콜 불필요
- **안정성**: BroadcastChannel을 사용할 수 없는 경우에도 작동

### 5. 리스 기반 하트비트를 사용하는 이유?

- **장애 허용**: 리스 만료 시 리더 장애 감지
- **자동 복구**: 리스 만료 시 새 리더 선출 가능
- **중앙 권한 없음**: 별도의 조정자가 필요 없음

### 6. 제너레이터 기반 스트림을 사용하는 이유?

- **현대적 API**: async/await 패턴 사용
- **취소 가능**: AbortSignal 지원
- **메모리 효율적**: 메시지가 소비되고 큐에서 제거됨
- **다중 소비자**: 여러 이터레이터가 동일한 스트림에서 소비 가능

---

## 성능 고려사항

### 메모리 관리

- **메시지 큐**: 마지막 이터레이터 종료 시 정리
- **이벤트 큐**: 마지막 이터레이터 종료 시 정리
- **콜백**: 구독 해제 시 제거
- **리졸버**: 해결 후 정리

### BroadcastChannel 성능

- **메시지 크기**: 메시지를 작게 유지 (권장: < 64KB)
- **메시지 빈도**: 높은 빈도의 메시지는 성능 문제를 일으킬 수 있음
- **탭 수**: 많은 탭에서 성능 저하

### localStorage 성능

- **읽기 빈도**: 폴링 간격이 합리적이어야 함 (기본값: 2초)
- **쓰기 빈도**: 하트비트 간격이 합리적이어야 함 (기본값: 2초)
- **저장소 크기**: localStorage는 크기 제한이 있음 (~5-10MB)

### 제너레이터 성능

- **다중 이터레이터**: 각 이터레이터가 메시지를 독립적으로 소비
- **큐 정리**: 마지막 이터레이터가 종료될 때만 큐 정리
- **AbortSignal**: 적절한 정리로 메모리 누수 방지

---

## 결론

purrtabby는 단순성과 경량을 염두에 두고 설계되었습니다. 순수 함수를 사용한 함수형 프로그래밍 접근 방식은 코드를 테스트하고 유지보수하기 쉽게 만듭니다. 제너레이터 기반 스트림은 메시지와 이벤트를 소비하기 위한 현대적인 API를 제공하며, 리스 기반 리더 선출은 탭 간 안정적인 조정을 보장합니다.

주요 강점:
- **경량**: 최소한의 번들 크기
- **테스트 가능**: 순수 함수로 포괄적인 테스트 가능
- **현대적**: 비동기 이터러블과 TypeScript 사용
- **안정적**: 리스 기반 하트비트로 장애 허용 보장
- **단순함**: 명확한 관심사 분리와 명시적 의존성

---

## 부록: 리더 선출 알고리즘 상세 설명

이 섹션에서는 purrtabby의 리더 선출이 어떻게 작동하는지 단계별로 설명합니다.

### 개요

리더 선출은 `localStorage`에 저장된 **리스(lease) 기반 메커니즘**을 사용합니다. 리스는 다음을 포함합니다:
- `tabId`: 현재 리더 탭의 식별자
- `timestamp`: 리스가 마지막으로 업데이트된 시간
- `leaseMs`: 리스가 유효한 지속 시간 (기본값: 5000ms)

### 단계별: 리더십 획득

`leader.start()`가 호출되면 다음 과정이 발생합니다:

#### 1단계: 초기 획득 시도

```typescript
tryAcquireLeadership(state, eventQueue)
```

1. **현재 리스 읽기** (localStorage에서):
   ```typescript
   const currentLease = readLeaderLease(state.key);
   ```

2. **리스 유효성 확인**:
   ```typescript
   isValidLeaderLease(currentLease)
   // 다음 경우 false 반환:
   // - lease가 null/undefined
   // - lease.timestamp + lease.leaseMs < Date.now() (만료됨)
   ```

3. **리스가 유효하지 않은 경우 (리더 없음 또는 만료)**:
   - 현재 탭의 ID로 새 리스 생성:
     ```typescript
     const newLease = {
       tabId: state.tabId,
       timestamp: Date.now(),
       leaseMs: state.leaseMs,
     };
     writeLeaderLease(state.key, newLease);
     ```
   - **이중 확인**: 리스를 다시 읽어서 우리가 획득했는지 확인
     - 여러 탭이 동시에 시도할 때의 경쟁 조건 처리
     - 하나의 탭만 성공적으로 쓰기 가능 (마지막 쓰기가 승리)
   - `acquiredLease.tabId === state.tabId`인 경우:
     - `state.isLeader = true` 설정
     - `'acquire'` 이벤트 발생
     - `true` 반환

4. **리스가 유효하고 이 탭에 속한 경우**:
   - `state.isLeader = true` 설정 (아직 리더가 아니었다면)
   - `'acquire'` 이벤트 발생 (이전에 리더가 아니었다면)
   - `true` 반환

5. **리스가 유효하지만 다른 탭에 속한 경우**:
   - 이전에 리더였다면 `'lose'` 이벤트 발생
   - `state.isLeader = false` 설정
   - `false` 반환

### 단계별: 리더십 유지 (하트비트)

탭이 리더가 되면 주기적으로 리스를 갱신해야 합니다:

#### 하트비트 타이머

```typescript
setInterval(() => {
  sendLeaderHeartbeat(state, eventQueue);
}, heartbeatMs + jitter);
```

**하트비트 과정** (`sendLeaderHeartbeat`):

1. **전제 조건 확인**:
   ```typescript
   if (state.stopped || !state.isLeader) return;
   ```

2. **현재 리스 읽기**:
   ```typescript
   const currentLease = readLeaderLease(state.key);
   ```

3. **리스가 여전히 이 탭에 속한 경우**:
   - 타임스탬프 업데이트:
     ```typescript
     const updatedLease = {
       ...currentLease,
       timestamp: Date.now(),
     };
     writeLeaderLease(state.key, updatedLease);
     ```
   - 리스가 또 다른 `leaseMs` 기간 동안 갱신됨

4. **리스가 다른 탭에 속한 경우**:
   - `state.isLeader = false` 설정
   - `'lose'` 이벤트 발생
   - 다음 경우에 발생할 수 있음:
     - 다른 탭이 리더십을 획득함
     - 탭이 비활성 상태였고 리스가 만료됨

### 단계별: 리더십 변경 감지 (폴링)

리더가 아닌 탭들은 주기적으로 리더십 기회를 확인합니다:

#### 체크 타이머

```typescript
setInterval(() => {
  checkLeaderLeadership(state, eventQueue);
}, heartbeatMs / 2 + jitter);
```

**체크 과정** (`checkLeaderLeadership`):

1. **현재 리스 읽기**:
   ```typescript
   const currentLease = readLeaderLease(state.key);
   ```

2. **현재 상태 결정**:
   ```typescript
   const wasLeader = state.isLeader;
   const isNowLeader = currentLease?.tabId === state.tabId 
                     && isValidLeaderLease(currentLease);
   ```

3. **상태 전환 처리**:
   - **리더가 됨** (`!wasLeader && isNowLeader`):
     - `state.isLeader = true` 설정
     - `'acquire'` 이벤트 발생
   
   - **리더십 상실** (`wasLeader && !isNowLeader`):
     - `state.isLeader = false` 설정
     - `newLeader` 메타데이터와 함께 `'lose'` 이벤트 발생
   
   - **리더십 변경** (`wasLeader && isNowLeader && currentLease.tabId !== state.tabId`):
     - 이 경우는 논리적으로 불가능 (만약 `isNowLeader`라면 `currentLease.tabId === state.tabId`)
     - `'change'` 이벤트 발생 (엣지 케이스 처리)

### 경쟁 조건 처리

**문제**: 여러 탭이 동시에 리더십을 획득하려고 시도할 수 있습니다.

**해결**: 이중 확인 패턴:
1. localStorage에 리스 쓰기
2. 즉시 다시 읽기
3. 읽은 값이 우리의 tabId와 일치할 때만 리더십 획득으로 간주

이렇게 하면 경쟁 조건에서도 하나의 탭만 성공합니다.

### 리스 만료

리스는 다음 경우에 만료됩니다:
```typescript
lease.timestamp + lease.leaseMs < Date.now()
```

**만료된 리스 처리**:
- 리스가 만료되면 어떤 탭이든 리더십을 획득할 수 있음
- 리더는 만료 전에 리스를 갱신해야 함 (하트비트를 통해)
- 리더 탭이 크래시/종료되면 리스가 만료되고 다른 탭이 인수할 수 있음

### 예시 타임라인

```
시간 0ms:   탭 A 시작, 리더십 획득 (리스 만료: 5000ms)
시간 2000ms: 탭 A 하트비트 전송 (리스 만료: 7000ms)
시간 3000ms: 탭 B 시작, 유효한 리스 확인 (탭 A가 리더)
시간 4000ms: 탭 A 하트비트 전송 (리스 만료: 9000ms)
시간 5000ms: 탭 A 종료/크래시
시간 6000ms: 탭 B 확인, 만료된 리스 확인, 리더십 획득
시간 8000ms: 탭 B 하트비트 전송 (리스 만료: 13000ms)
```

### 주요 설계 결정

1. **왜 localStorage인가?**
   - 동기 API (비동기 오버헤드 없음)
   - 같은 origin의 모든 탭에서 공유
   - 페이지 리로드 후에도 지속 (만료와 함께)

2. **왜 이중 확인인가?**
   - 여러 탭이 경쟁할 때의 경쟁 조건 처리
   - 하나의 탭만 성공하도록 보장

3. **왜 하트비트인가?**
   - 리더가 여전히 살아있음을 증명
   - 리더 탭이 크래시하면 오래된 리더십 방지

4. **왜 폴링인가?**
   - 리더십 변경 감지
   - 리스가 만료되면 비리더가 획득 가능
   - Storage 이벤트도 도움이 되지만 폴링이 안정성 보장
