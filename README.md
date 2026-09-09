# chizumulu-subdomain

`chizumulu.net`의 서브도메인을 무료로 신청할 수 있는 레포입니다.

## 신청 방법

1. 이 레포를 fork 합니다.
2. `subdomains/<원하는이름>.json` 파일을 만듭니다. 파일명이 곧 서브도메인 이름입니다.

```json
{
  "owner": {
    "username": "your-github-id",
    "email": "you@example.com"
  },
  "records": [
    { "type": "CNAME", "name": "@", "content": "your-target.example.com" }
  ]
}
```

3. PR을 보냅니다. GitHub Actions가 형식을 자동 검증합니다.
4. PR에 프리뷰 사이트 링크(Cloudflare Pages)가 달립니다. 관리자가 신청 내용을 검토합니다.
5. 머지되면 Cloudflare에 DNS 레코드가 자동으로 생성/갱신됩니다.

> 여러 레코드 타입을 조합한 예시는 [`examples/example.json`](examples/example.json) 참고 (이 파일은 `subdomains/`가 아니라 실제 배포되지 않음).

## 지원 레코드 타입

- `CNAME`: 다른 도메인을 가리킬 때. 같은 name에 다른 타입과 공존 불가.
- `A`: IPv4 주소를 가리킬 때.
- `TXT`: 검증용 텍스트 레코드. 외부 서비스 소유권 증명에 악용될 수 있으니 관리자가 PR 리뷰 시 content 내용을 확인합니다.

## 이름 규칙

- 소문자, 숫자, 하이픈만 허용 (하이픈으로 시작/끝 불가).
- 예약어 사용 불가: `www`, `api`, `admin`, `mail`, `smtp`, `pop`, `imap`, `ftp`,
  `ns1`, `ns2`, `cpanel`, `webmail`, `autodiscover`, `autoconfig`, `cloudflare`,
  `dns`, `chizumulu`, `root`, `status`, `support`, `help`, `blog`, `shop`, `store`.
- `owner.username`은 PR을 여는 본인의 GitHub 아이디와 같아야 합니다.

## `proxied` (Cloudflare 프록시)

```json
{
  "owner": { "...": "..." },
  "records": [
    { "type": "A", "name": "@", "content": "1.2.3.4", "proxied": true }
  ],
  "proxied": false
}
```

- 레코드 안의 `proxied`가 최우선, 없으면 파일 최상위 `proxied`(전체 기본값), 그것도 없으면 `false`.
- `true`로 켜면 Cloudflare가 오렌지 클라우드(CDN/WAF)로 감싸서 origin IP를 가려주지만, **origin이 실제로 응답하는 서버여야** 합니다. 응답 안 하는 IP(특히 Cloudflare 소유 IP 대역)를 가리키면 522/1034 같은 Cloudflare 자체 에러가 뜹니다 — 리포/DNS 설정 문제가 아니라 origin이 잘못된 경우입니다.

## 로컬 검증

```bash
npm install
node scripts/validate.mjs subdomains/<이름>.json
```

## 동작 원리 (아키텍처)

```
fork → subdomains/<이름>.json 작성 → PR
         │
         ▼
  [validate.yml, on: pull_request]
    1. scripts/validate.mjs   — 스키마 + 이름 규칙 + 레코드 규칙 검증
    2. scripts/check-pr.mjs   — PR 작성자 == owner.username 검증
    3. scripts/build-preview.mjs — 전체 목록 미리보기 HTML 빌드 (artifact 업로드)
         │  (관리자가 PR 리뷰, 특히 TXT record content 확인)
         ▼
        merge (main)
         │
         ▼
  [deploy.yml, on: push to main]
    scripts/deploy.mjs — 바뀐 파일들만 골라 Cloudflare DNS API로 반영
    (JSON에 있는 상태와 Cloudflare에 있는 상태를 diff해서 생성/수정/삭제)
```

파일 하나 = 서브도메인 하나가 이 리포의 핵심 규칙입니다 (`scripts/lib.mjs`의 `subdomainNameFromPath`). 검증(PR 시점)과 배포(merge 시점)가 완전히 분리돼있어서, PR이 열려있는 동안엔 실제 DNS에 아무 영향이 없습니다.

## 트러블슈팅

- **Error 1034 / "Edge IP Restricted"**: `content`로 지정한 IP가 Cloudflare 소유 대역(예: `1.1.1.1`)일 때 발생합니다. Cloudflare 엣지가 "이 IP는 네 계정 소유가 아님"으로 판단해 차단하는 것 — DNS 레코드 자체는 정상 생성됐어도 그 IP가 실제로 서비스하는 서버가 아니면 이 에러가 납니다. 실제로 응답하는 origin IP/도메인으로 바꾸세요.
- **Error 522/526 (proxied 켰을 때)**: origin이 응답하지 않거나(522) TLS 핸드셰이크가 실패(526)하는 것. `proxied: false`로 끄고 origin에 직접 연결해서 원인을 먼저 확인하세요.
- **CNAME 관련 스키마 오류**: 같은 `name`에 CNAME과 A/TXT를 같이 못 씁니다 (DNS 표준 제약). 다른 `name`이면 문제없습니다.
