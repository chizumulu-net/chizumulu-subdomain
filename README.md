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

## 지원 레코드 타입

- `CNAME`: 다른 도메인을 가리킬 때. 같은 name에 다른 타입과 공존 불가.
- `A`: IPv4 주소를 가리킬 때.
- `TXT`: 검증용 텍스트 레코드.

## 이름 규칙

- 소문자, 숫자, 하이픈만 허용 (하이픈으로 시작/끝 불가).
- 예약어 사용 불가: `www`, `api`, `admin`, `mail`, `smtp`, `pop`, `imap`, `ftp`,
  `ns1`, `ns2`, `cpanel`, `webmail`, `autodiscover`, `autoconfig`, `cloudflare`,
  `dns`, `chizumulu`, `root`, `status`, `support`, `help`, `blog`, `shop`, `store`.
- `owner.username`은 PR을 여는 본인의 GitHub 아이디와 같아야 합니다.

## 로컬 검증

```bash
npm install
node scripts/validate.mjs subdomains/<이름>.json
```
