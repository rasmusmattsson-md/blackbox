# Installation

Den här guiden tar dig från tomt konto till en körande MCP-server som Claude kan
ansluta till.

**Läs ordningen först.** Stegen nedan måste göras i tur och ordning. Auth0 visar
bara ett fel i taget, och varje fel döljer nästa — hoppar du över ett steg får du
ett felmeddelande som pekar någon helt annanstans. Ordningen är inte en
rekommendation.

Räkna med 45–60 minuter första gången.

---

## Innehåll

1. [Vad du behöver](#1-vad-du-behöver)
2. [Installera Auth0 CLI](#2-installera-auth0-cli)
3. [Google Cloud](#3-google-cloud)
4. [Auth0 — applikationen](#4-auth0--applikationen)
5. [Auth0 — API:et](#5-auth0--apiet)
6. [Auth0 — My Account API](#6-auth0--my-account-api)
7. [Auth0 — Google-kopplingen](#7-auth0--google-kopplingen)
8. [Kör lokalt](#8-kör-lokalt)
9. [Driftsätt på Azure](#9-driftsätt-på-azure)
10. [Anslut Claude](#10-anslut-claude)
11. [Verifiera allt med CLI](#11-verifiera-allt-med-cli)
12. [Felsökning](#12-felsökning)

---

## 1. Vad du behöver

| Sak | Kommentar |
|---|---|
| **Ett Google Cloud-projekt** | Här bor OAuth-klienten och de API:er som läses. |
| **En Auth0-tenant** | Både inloggning och Token Vault. Gratisnivån räcker för att komma igång. |
| **Ett Azure-konto** | Eller vilken Node-värd som helst — Vercel, en container, en VM. |
| **Node 20 eller senare** | |
| **Auth0 CLI** | Steg 2. Inte valfri: två av stegen går inte att göra i webbgränssnittet. |

Det finns ingen databas att sätta upp. Servern lagrar ingenting som överlever ett
anrop — Googles refresh-token ligger i Auth0:s Token Vault, inte hos dig.

---

## 2. Installera Auth0 CLI

```bash
# macOS
brew install auth0

# Windows
scoop install auth0

# Linux
curl -sSfL https://raw.githubusercontent.com/auth0/auth0-cli/main/install.sh | sh -s -- -b .
```

Logga in mot din tenant:

```bash
auth0 login
```

**Varför den behövs.** Det mesta går att klicka fram, men inte allt, och
webbgränssnittet visar inte alltid varför något inte fungerar. CLI:t läser den
faktiska konfigurationen. Steg 11 är ett verifieringsskript som på tio sekunder
säger vad som är fel — jämfört med att gissa sig igenom sex inställningar.

> **Varning.** `auth0 api patch connections/...` **ersätter hela `options`** i
> stället för att slå ihop. Skickar du bara `scope` försvinner klient-id,
> klienthemlighet och allt annat i samma objekt, tyst. Läs alltid ut objektet
> först, slå ihop, skriv tillbaka allt. Det gäller `connections`; `clients` och
> `resource-servers` beter sig normalt.

---

## 3. Google Cloud

[console.cloud.google.com](https://console.cloud.google.com)

### 3.1 Skapa ett projekt

Valfritt namn. Notera projekt-id:t.

### 3.2 Aktivera API:erna

**APIs & Services → Library**, aktivera:

- **Google Analytics Data API**
- **Google Analytics Admin API**
- **BigQuery API**

Utan dessa svarar Google med `403 API has not been used in project …` vid första
verktygsanropet, inte vid inloggningen.

### 3.3 Samtyckesskärmen

**APIs & Services → OAuth consent screen**

Lägg till scopen:

```
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/bigquery.readonly
```

> **Båda är känsliga scope hos Google.** En overifierad app får ha högst 100
> användare. Ska fler än så använda installationen behöver appen genomgå Googles
> granskning, vilket tar veckor. Planera för det tidigt om det är aktuellt — är
> alla användare i samma Google Workspace kan du välja **Internal** i stället och
> slippa granskningen helt.

### 3.4 Skapa OAuth-klienten

**Credentials → Create credentials → OAuth client ID → Web application**

Under **Authorized redirect URIs**, lägg till Auth0:s callback — **inte** din
egen adress:

```
https://DIN-TENANT.REGION.auth0.com/login/callback
```

Lämna **Authorized JavaScript origins** tomt. Ingenting anropar Google från
webbläsaren.

Spara **Client ID** och **Client Secret**. Hemligheten visas en gång.

---

## 4. Auth0 — applikationen

[manage.auth0.com](https://manage.auth0.com) → **Applications → Applications →
Create Application → Regular Web App**

### 4.1 Settings

| Fält | Värde |
|---|---|
| Allowed Callback URLs | `https://din-app.example.com/auth/callback`, `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `https://din-app.example.com`, `http://localhost:3000` |
| Allowed Web Origins | lämna tomt |

### 4.2 Grant Types

**Advanced Settings → Grant Types** — kryssa i, utöver de förvalda:

- **Refresh Token**
- **Token Vault**

`Token Vault` är den som ger felet
`unauthorized_client: Grant type '…federated-connection-access-token' not allowed
for the client` om den saknas.

Notera **Domain**, **Client ID** och **Client Secret**.

---

## 5. Auth0 — API:et

**Applications → APIs → Create API**

| Fält | Värde |
|---|---|
| Name | valfritt, t.ex. `BlackBox MCP` |
| Identifier | **exakt** `https://din-app.example.com/api/mcp` |
| Signing Algorithm | RS256 |

> **Identifieraren går inte att ändra efteråt.** Den måste vara identisk med
> adressen användaren skriver in i Claude, `/api/mcp` inräknat. Ska du köra både
> lokalt och i drift: skapa **två** API:er, ett med `http://localhost:3000/api/mcp`
> och ett med produktionsadressen.

Sedan i API:ets **Settings → Access Settings**:

- **Allow Offline Access** → **på**

Och i **Application Access**-fliken: hitta din applikation → **Grant Access**.
Inga permissions behöver väljas — det är själva grant:et som saknas annars.

---

## 6. Auth0 — My Account API

**Det här steget är det som är lättast att missa och svårast att felsöka.**
Att koppla ett Google-konto sker via Auth0:s My Account API, som inte finns
aktiverat i en ny tenant.

### 6.1 Aktivera

**Applications → APIs** → bannern **MyAccount API** → **Activate**.

Auth0 skapar då API:et med rätt scope. Kontrollera att det dykt upp i listan.

### 6.2 Ge applikationen åtkomst

**Applications → APIs → My Account API → Application Access** → din applikation →
**Edit** → kryssa i `create:me:connected_accounts` → **Grant Access**.

### 6.3 Multi-Resource Refresh Token

**Applications → \<din app\> → Advanced Settings → Multi-Resource Refresh Token →
Edit Configuration** → slå på för **Auth0 My Account API**.

Utan det här byts inloggningens refresh-token aldrig mot en My Account-token, och
kopplingsflödet dör med *"An unexpected error occurred while trying to initiate
the connect account flow"* — ett meddelande som inte säger någonting.

Går något av 6.1–6.3 inte att klicka fram, gör det med CLI:t:

```bash
DOMAIN=din-tenant.region.auth0.com
CLIENT_ID=ditt-client-id

# 6.1 aktivera
auth0 api post resource-servers --data "{
  \"identifier\": \"https://$DOMAIN/me/\",
  \"name\": \"Auth0 My Account API\"
}"

# 6.2 ge applikationen åtkomst
auth0 api post client-grants --data "{
  \"client_id\": \"$CLIENT_ID\",
  \"audience\": \"https://$DOMAIN/me/\",
  \"scope\": [\"create:me:connected_accounts\"],
  \"subject_type\": \"user\"
}"
```

För 6.3, läs ut nuvarande `refresh_token`-objekt och skriv tillbaka det med en
policy till för `https://$DOMAIN/me/` — se verifieringsskriptet i steg 11.

> **Ordningen spelar roll här.** Skriver du MRRT-policyn innan API:et är
> aktiverat kastas den tyst: Auth0 accepterar anropet men sparar inte en policy
> för en audience som inte är en registrerad resource server.

---

## 7. Auth0 — Google-kopplingen

**Authentication → Social → Google** (skapa den om den inte finns).

| Inställning | Värde |
|---|---|
| Client ID / Client Secret | **dina egna** från steg 3.4 |
| Purpose | **Authentication and Connected Accounts for Token Vault** |
| Access Type → Offline Access | ikryssad |
| Permissions | `analytics.readonly` och `bigquery.readonly` |
| Applications | din applikation påslagen |

**Lämna inte klient-id och hemlighet tomma.** Då används Auth0:s utvecklings-
nycklar, som varken kan begära Analytics- eller BigQuery-scope och inte får
driftsättas. Du känner igen dem på att Googles samtyckesskärm säger *"to continue
to auth0.com"* i stället för ditt appnamn.

**Purpose måste vara det tredje alternativet.** Bara "Authentication" ger en
inloggning som fungerar men ett tomt valv. Bara "Connected Accounts" ger felet
*"The connection is not active for authentication."*

---

## 8. Kör lokalt

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fyll i `.env.local`:

```bash
APP_URL=http://localhost:3000
AUTH0_DOMAIN=din-tenant.region.auth0.com
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_SECRET=          # openssl rand -hex 32
```

> `APP_URL` måste matcha **porten som `next dev` faktiskt startade på** och
> API-identifieraren i steg 5. `next dev` tar nästa lediga port om 3000 är
> upptagen, och en felaktig `APP_URL` ger `Service not found` från Auth0.

Öppna konsolen, **Logga in**, och klicka **Anslut** på en av datakällorna. Google
ska då fråga om åtkomst till Analytics **och** BigQuery. Ser du inte den frågan
har något av stegen 3.3, 6 eller 7 inte tagit.

> **Spara Googles klienthemlighet någon annanstans än i Auth0.** Auth0 visar
> aldrig upp den igen, och Google visar den bara vid skapandet. Försvinner den ur
> kopplingen — vilket en slarvig `auth0 api patch` gör på ett ögonblick — går den
> bara att hämta genom att skapa en ny hemlighet i Google Cloud.

---

## 9. Driftsätt på Azure

Vilken Node-värd som helst fungerar. Så här med **Azure App Service**:

### 9.1 Skapa resursen

```bash
az group create --name blackbox-mcp --location swedencentral

az appservice plan create --name blackbox-mcp-plan \
  --resource-group blackbox-mcp --is-linux --sku B1

az webapp create --name DITT-APPNAMN \
  --resource-group blackbox-mcp --plan blackbox-mcp-plan \
  --runtime "NODE:20-lts"
```

### 9.2 Miljövariabler

```bash
az webapp config appsettings set --name DITT-APPNAMN \
  --resource-group blackbox-mcp --settings \
  APP_URL="https://DITT-APPNAMN.azurewebsites.net" \
  AUTH0_DOMAIN="din-tenant.region.auth0.com" \
  AUTH0_CLIENT_ID="..." \
  AUTH0_CLIENT_SECRET="..." \
  AUTH0_SECRET="$(openssl rand -hex 32)" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

Sätt **inte** `WEBSITES_PORT`. `next start` lyssnar på den port `PORT` anger, och
den sätter App Service själv. Pinnar du en egen port som inte råkar stämma
startar containern men svarar aldrig, vilket ser ut som ett hängt bygge.

`AUTH0_SECRET` ska vara **en annan** än den lokala. Delar du en mellan utveckling
och drift fungerar en stulen utvecklingskaka mot produktion.

### 9.3 Startkommando

```bash
az webapp config set --name DITT-APPNAMN --resource-group blackbox-mcp \
  --startup-file "npm run start"
```

### 9.4 Driftsätt

```bash
npm run build
az webapp up --name DITT-APPNAMN --resource-group blackbox-mcp
```

### 9.5 Uppdatera Auth0 och Google

Nu när den publika adressen finns:

- **Auth0-applikationen**: lägg till `https://DITT-APPNAMN.azurewebsites.net/auth/callback`
  bland callback-URL:erna och adressen utan sökväg bland logout-URL:erna.
- **Auth0-API:et**: identifieraren kan inte ändras. Skapa ett nytt API med
  `https://DITT-APPNAMN.azurewebsites.net/api/mcp`, slå på Allow Offline Access,
  och ge applikationen åtkomst (steg 5 igen). Lägg även till det i
  MRRT-konfigurationen.
- **Google Cloud**: redirect-URI:n pekar på Auth0, inte på Azure, så den behöver
  inte ändras.

Egen domän i stället för `*.azurewebsites.net` är att föredra — då slipper du
göra om det här när adressen byts.

---

## 10. Anslut Claude

I Auth0: slå på **Dynamic Client Registration** för tenanten, så att claude.ai
kan registrera sig själv.

### claude.ai

Inställningar → **Kopplingar** → **Lägg till egen koppling**:

```
https://DITT-APPNAMN.azurewebsites.net/api/mcp
```

Adressen måste vara **exakt** densamma som API-identifieraren i Auth0.

### Claude Code

```bash
claude mcp add --transport http blackbox https://DITT-APPNAMN.azurewebsites.net/api/mcp
```

---

## 11. Verifiera allt med CLI

Spara som `verify.sh`, fyll i de tre variablerna, kör. Skriptet påstår inte bara
vad som är konfigurerat — det säger vad som är **fel** och vilket steg som fixar
det.

```bash
#!/usr/bin/env bash
DOMAIN="din-tenant.region.auth0.com"
CLIENT_ID="ditt-client-id"
CONNECTION="google-oauth2"   # AUTH0_CONNECTION, om du bytt namn

export DOMAIN CLIENT_ID CONNECTION

echo "— Applikationen —"
auth0 api get "clients/$CLIENT_ID" | python3 -c '
import json,os,sys; d=json.load(sys.stdin); dom=os.environ["DOMAIN"]
need = {"authorization_code","refresh_token",
        "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token"}
have = set(d.get("grant_types",[]))
ok = lambda b: "OK " if b else "FEL"
print(" ", ok(d.get("is_first_party")), "first party")
print(" ", ok(d.get("oidc_conformant")), "oidc conformant")
print(" ", ok(d.get("token_endpoint_auth_method") != "none"), "confidential client")
print(" ", ok(need <= have), "grant types", "" if need <= have else f"— saknar {need-have} (steg 4.2)")
pol = {p["audience"] for p in d.get("refresh_token",{}).get("policies",[])}
print(" ", ok(f"https://{dom}/me/" in pol), "MRRT för My Account API",
      "" if f"https://{dom}/me/" in pol else "— steg 6.3 (kräver att 6.1 gjorts först)")
print("    MRRT-policyer:", sorted(pol))
'

echo "— API:er —"
auth0 api get "resource-servers" | python3 -c '
import json,os,sys; d=json.load(sys.stdin); dom=os.environ["DOMAIN"]
rs = d if isinstance(d,list) else d.get("resource_servers",[])
ids = [r.get("identifier") for r in rs]
me = f"https://{dom}/me/"
print(" ", "OK " if me in ids else "FEL", "My Account API aktiverat",
      "" if me in ids else "— steg 6.1")
for i in ids: print("    ", i)
'

echo "— Client grant på My Account API —"
auth0 api get "client-grants?client_id=$CLIENT_ID" | python3 -c '
import json,os,sys; d=json.load(sys.stdin); dom=os.environ["DOMAIN"]
gs = d if isinstance(d,list) else d.get("client_grants",[])
me = f"https://{dom}/me/"
hit = [g for g in gs if g.get("audience")==me
       and "create:me:connected_accounts" in g.get("scope",[])]
print(" ", "OK " if hit else "FEL", "create:me:connected_accounts",
      "" if hit else "— steg 6.2")
'

echo "— Google-kopplingen —"
auth0 api get "connections?strategy=google-oauth2" | python3 -c '
import json,os,sys; d=json.load(sys.stdin); want=os.environ["CONNECTION"]
cs = d if isinstance(d,list) else d.get("connections",[])
m = [c for c in cs if c.get("name")==want]
if not m:
    print(f"  FEL ingen koppling heter {want!r}. Finns:", [c.get("name") for c in cs])
    sys.exit(1)
c = m[0]; o = c.get("options",{})
ok = lambda b: "OK " if b else "FEL"
scopes = o.get("scope") or []
print("  kontrollerar:", c.get("name"))
print(" ", ok(o.get("client_id") and o.get("client_secret")),
      "egna Google-nycklar", "" if o.get("client_secret") else "— steg 7 (hemligheten hämtas från Google Cloud)")
print(" ", ok(o.get("offline_access")), "offline access — steg 7")
print(" ", ok((o.get("upstream_params") or {}).get("access_type")), "access_type=offline")
print(" ", ok(any("analytics.readonly" in x for x in scopes)), "analytics.readonly")
print(" ", ok(any("bigquery.readonly" in x for x in scopes)), "bigquery.readonly")
print(" ", ok((c.get("authentication") or {}).get("active")), "Purpose: authentication")
print(" ", ok((c.get("connected_accounts") or {}).get("active")), "Purpose: connected accounts")
'
```

Allt ska säga `OK`. De två som lättast ser rätt ut men inte är det:

- **My Account API i `resource-servers`.** Saknas den går MRRT-policyn inte att
  spara — Auth0 tar emot skrivningen och kastar den tyst. Det ser ut som att
  inställningen inte fastnar.
- **Båda Purpose-flaggorna.** `authentication` *och* `connected_accounts` måste
  vara `active`. Bara den ena ger en inloggning som fungerar med ett tomt valv,
  eller ett valv som inte går att logga in mot.

När en användare har kopplat sitt konto, kontrollera att det faktiskt lagrades:

```bash
auth0 api get "users/URL-KODAT-USER-ID/connected-accounts"
```

Är listan tom har kopplingsflödet aldrig gått igenom, oavsett vad konsolen visar.
Kontrollera också att posten har **båda** scopen — en koppling gjord innan
BigQuery lades till har bara Analytics, och då är BigQuery-kortet rött medan
Analytics är grönt.

---

## 12. Felsökning

Felen kommer ett i taget och i den här ordningen. Ser du ett längre ned i
tabellen är allt ovanför redan rätt.

| Fel | Orsak |
|---|---|
| `server_misconfigured` med en lista | Miljövariabler saknas. Konsolens startsida visar samma lista. |
| `Service not found: http://...` | `APP_URL` matchar inte API-identifieraren i Auth0. Ofta fel port lokalt. |
| `Client … is not authorized to access resource server …` | Steg 5, **Grant Access** på API:ets Application Access-flik. |
| `The connection is not active for authentication.` | Steg 7, Purpose måste vara det tredje alternativet. |
| `A refresh token was not present…` | Steg 5, **Allow Offline Access**. Logga ut och in igen efteråt. |
| `unauthorized_client: Grant type '…federated-connection-access-token'…` | Steg 4.2, kryssa i **Token Vault**. |
| `An unexpected error occurred while trying to initiate the connect account flow` | Steg 6. Nästan alltid MRRT (6.3) eller att My Account API inte är aktiverat (6.1). |
| `federated_connection_refresh_token_not_found` | Valvet är tomt. Klicka **Anslut** — inloggning räcker inte, det är två olika flöden. |
| Googles samtyckesskärm säger "to continue to auth0.com" | Steg 7, egna nycklar saknas. |
| Samtyckesskärmen frågar inte om Analytics/BigQuery | Steg 3.3 eller Permissions i steg 7. |
| `403 API has not been used in project …` | Steg 3.2, API:et är inte aktiverat i Google Cloud. |
| `Missing required OAuth scope. Need BigQuery … write access` | Frågan skriver till en destinationstabell. Den här servern är läsbehörig med flit. |
| Kortet är grönt men verktygsanrop misslyckas | Scopet saknas på den kopplade behörigheten. Koppla om. |

**Kommer du ingen vart:** öppna **Auth0 → Monitoring → Logs** och expandera den
senaste posten. Den säger vad Auth0 faktiskt gjorde, vilka scope som beviljades
och vilken audience som utfärdades — och besvarar på ett steg det som annars blir
en halvdags gissande. Gå dit tidigt, inte sist.

---

## Bilaga: miljövariabler

### Obligatoriska

| Variabel | |
|---|---|
| `APP_URL` | Publik adress. Bygger MCP-adressen, resource-identiteten, `audience` och callback-URL:erna. På Vercel hittas den automatiskt. |
| `AUTH0_DOMAIN` | `din-tenant.region.auth0.com`, utan schema. |
| `AUTH0_CLIENT_ID` | |
| `AUTH0_CLIENT_SECRET` | |
| `AUTH0_SECRET` | Krypterar sessionskakan. `openssl rand -hex 32`. Egen per miljö. |

### Valfria

| Variabel | |
|---|---|
| `AUTH0_CONNECTION` | Kopplingens namn. Standard `google-oauth2`. |
| `AUTH0_AUDIENCE` | Vilket `aud` inkommande tokens måste bära. Standard är API-identifieraren. `none` stänger av kontrollen — sista utvägen. |
| `GA4_PROPERTY_ID` | Egenskapen som används när modellen inte anger någon. |
| `BIGQUERY_PROJECT_ID` | Projektet som används när modellen inte anger något. |
| `BIGQUERY_MAX_BYTES_BILLED` | Tak per fråga i bytes. Standard 5 GB. `0` stänger av taket. |
| `MCP_RESOURCE_URL` | Identiteten tokens utfärdas för. Standard `APP_URL` + `/api/mcp`. |
