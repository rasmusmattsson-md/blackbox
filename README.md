# BlackBox MCP

En [MCP](https://modelcontextprotocol.io)-server som ger en AI-assistent
läsbehörighet till din egen Google Analytics och BigQuery.

Två delar:

- **En konsol** där du loggar in med Google, kopplar dina datakällor och
  kopierar serverns adress.
- **En MCP-endpoint** på `/api/mcp`:
  - Google Analytics: `list_properties`, `run_report`, `find_fields`
  - BigQuery: `list_datasets`, `list_tables`, `describe_table`, `run_query`

Båda läser via samma Google-konto, och båda är läsbehöriga: `analytics.readonly`
och `bigquery.readonly`. Servern kan aldrig skriva.

---

## 1. Hur det hänger ihop

Auth0 gör två saker, och det är därför det inte finns någon databas här.

**Auktorisationsserver.** Claude läser
`/.well-known/oauth-protected-resource`, hittar din Auth0-tenant, registrerar
sig själv och skickar en bearer-token. Servern verifierar den mot Auth0:s JWKS.

**Token Vault.** Du loggar in med Google. Auth0 behåller Googles refresh-token
och lämnar ut en färsk access-token när servern ber om en. Servern sparar
ingenting: inga krypterade rader, ingen nyckel att ta backup på, ingen
refresh-logik.

Kvar finns två externa beroenden — Auth0 och Google Cloud — plus någonstans att
köra Next.js.

```
proxy.ts               Auth0:s /auth/*-rutter och sessionen
lib/auth0.ts           klienten, och vad hela installationen saknar
lib/config.ts          serverns egen adress, som fyra saker måste vara överens om
lib/mcp-auth.ts        verifierar inkommande tokens på /api/mcp
lib/google.ts          växlar en token mot en Google-token — de två vägarna
lib/connectors/        en fil per datakälla, plus registret
lib/ga4/api.ts         Google Analytics, utan åsikt om vem som frågar
lib/bigquery/api.ts    BigQuery, likaså
app/api/mcp/route.ts   autentisera, lämna sedan över registret till MCP-hanteraren
```

Det bärande begreppet är **tokenväxlingen**: den som anropar `/api/mcp` får sin
egen Google-token härledd ur den token de själva visade upp. Två personer mot
samma server får därför två olika Google-konton, utan att något däremellan
behöver minnas vem som är vem — identitet och behörighet kan inte glida isär,
eftersom den ena räknas fram ur den andra.

---

## 2. Vad du behöver

| Sak | Kommentar |
|---|---|
| **Ett Auth0-konto** | Både inloggning och Token Vault. Gratisnivån räcker för att komma igång. |
| **En Google OAuth-klient** | Ligger i Auth0:s Google-koppling, inte i den här kodbasen. |
| **Någonstans att köra Next.js** | Vercel, Azure App Service, en container eller en VM. |

---

## 3. Installation

Hela uppsättningen — Google Cloud, Auth0, driftsättning på Azure — ligger i
**[INSTALL.md](INSTALL.md)**.

Den guiden är skriven i den ordning stegen måste göras. Auth0 visar bara ett fel
i taget och varje fel döljer nästa, så ett överhoppat steg ger ett felmeddelande
som pekar någon helt annanstans. INSTALL.md avslutas med en felsökningstabell som
mappar varje felmeddelande tillbaka till steget som orsakar det.

Kort version, för den som bara vill köra lokalt mot en redan konfigurerad tenant:

```bash
npm install
cp .env.example .env.local     # fyll i — varje variabel är dokumenterad i filen
npm run dev
```

---

## 4. Anslut en klient

### claude.ai

Inställningar → **Kopplingar** → **Lägg till egen koppling**:

```
https://din-adress.example.com/api/mcp
```

Claude hittar Auth0 själv, registrerar sig och frågar efter ditt konto.

### Claude Code

```bash
claude mcp add --transport http blackbox https://din-adress.example.com/api/mcp
```

---

## 5. Att koppla från

Det finns med flit ingen knapp för det i konsolen. Behörigheten ligger i Auth0:s
valv, inte här, så servern har ingenting att radera — en knapp skulle rapportera
en frånkoppling som inte hänt medan Claude fortsatte läsa.

Återkalla där behörigheten faktiskt finns:

- [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  tar bort appens åtkomst hos Google.
- Auth0 → **User Management → Users → \<användaren\>** tar bort sessionen och
  den lagrade kopplingen.

---

## 6. Felsökning

Felsökningstabellen ligger i **[INSTALL.md](INSTALL.md#12-felsökning)**, där varje
felmeddelande är kopplat till det installationssteg som orsakar det. Den står på
ett ställe med flit — två kopior driver isär, och den här är den som skulle ha
blivit inaktuell.

Kommer du ingen vart: öppna **Auth0 → Monitoring → Logs** och expandera den
senaste posten. Den säger vad Auth0 faktiskt gjorde, vilka scope som beviljades
och vilken audience som utfärdades.

---

## 7. Säkerhet

- **Ingen refresh-token lagras här.** Allt den här servern håller i är
  kortlivade access-tokens som går ut av sig själva. En läckt databas finns
  inte att läcka.
- **`AUTH0_CLIENT_SECRET` är den känsliga hemligheten nu.** Den kan växla en
  giltig användartoken mot den användarens Google-token. Det är samma klass av
  hemlighet som den gamla krypteringsnyckeln — skillnaden är att valvet drivs
  av Auth0 i stället för av dig.
- **Behörigheten är läsbara rapporter**, inget annat: `analytics.readonly`.
- **Committa aldrig `.env.local`.** Den är gitignorerad; `.env.example` är den
  som ska checkas in.

---

## 8. Lägga till en datakälla

En fil i `lib/connectors/` som implementerar `Connector`, plus en rad i
`lib/connectors/index.ts`. Den dyker då upp både i konsolen och i MCP-servern —
ingen av dem har någon egen lista.
