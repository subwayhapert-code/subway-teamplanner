# Subway teamplanner — zelfstandig op Render

Deze app heeft geen ChatGPT-account, OpenAI-dienst, Sites-plugin of AI-API nodig. De website, beschikbaarheid en beheerderslogin draaien op jouw Render-account. Deelnemers vullen met een uitnodigingslink hun tijden in. Alleen de beheerder ziet het teamoverzicht.

## Wat zit erin?

- Subway-kleuren groen en geel, een praktisch weekoverzicht en mobiele invoer.
- Meerdere tijdvakken per dag, opmerkingen, totaaluren en CSV-export voor Excel.
- Eén beheerdersaccount met e-mail en wachtwoord.
- Een geheime, eenmalige instelcode. Er is geen vrije registratie voor beheerders.
- Persoonlijke links voor deelnemers; zij kunnen elkaars invoer niet lezen.
- Een database op een permanente Render-schijf en een downloadbare back-up.

## Eerst: kosten en bestaande gegevens

De meegeleverde `render.yaml` gebruikt een **betaalde Starter-webservice met een permanente schijf van 1 GB**. Render toont de actuele kosten voordat je bevestigt. Het gratis webservice-abonnement heeft geen permanente schijf. Kies daarvoor dus niet zomaar Free: dan kunnen ingevulde gegevens na een herstart verdwijnen.

Dit pakket bevat **geen bestaande deelnemersgegevens, testgegevens, wachtwoorden of geheime codes**. Je huidige website blijft bestaan. Deze zelfstandige versie begint met een lege database. Gegevens uit de huidige website zijn nog niet overgezet; houd de oude website beschikbaar totdat een eventuele verhuizing gecontroleerd is. Persoonlijke links en uitnodigingslinks krijgen op Render een nieuw adres.

## 1. Bestanden in GitHub zetten

1. Pak het zipbestand uit.
2. Maak in jouw GitHub-account een **private repository**, bijvoorbeeld `subway-teamplanner`.
3. Upload de uitgepakte bestanden en mappen. Zet `package.json`, `server.mjs` en `render.yaml` rechtstreeks in de hoofdmap van de repository, dus niet in een extra onderliggende map.
4. Sla de bestanden op met een commit. Upload geen wachtwoorden, databasebestanden, `.env` of `node_modules`.

Het zipbestand zelf uploaden is niet voldoende: Render heeft de uitgepakte bronbestanden nodig.

## 2. Render koppelen

1. Open jouw Render-dashboard.
2. Kies **New → Blueprint** en verbind jouw GitHub-repository.
3. Render leest `render.yaml`. Controleer de webservice, regio Frankfurt en de permanente schijf op `/var/data`.
4. Controleer de kosten en bevestig alleen als je daarmee akkoord bent.
5. Wacht tot Render de service als **Live** weergeeft. Open de toegewezen `https://…onrender.com`-link.

De instellingen zijn al opgenomen:

| Instelling | Waarde |
|---|---|
| Runtime | Node.js 24 |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |
| Databasepad | `/var/data/planner.sqlite` |
| Permanente schijf | 1 GB, gekoppeld aan `/var/data` |

Gebruik één serverinstantie voor deze SQLite-uitvoering. De schijf is nodig tijdens het uitvoeren, niet tijdens het bouwen.

## 3. Alleen jouw beheerdersaccount instellen

1. Open in Render jouw service → **Environment**.
2. Render heeft automatisch een lange willekeurige waarde gemaakt voor `ADMIN_SETUP_TOKEN`. Bekijk en kopieer die waarde alleen voor jezelf.
3. Open de website en kies **Eenmalig instellen door eigenaar**.
4. Vul de geheime instelcode, jouw e-mailadres en een eigen wachtwoord van minimaal 12 tekens in.
5. Klik **Beheerder instellen**. Daarna ben je ingelogd en kopieer je de uitnodigingslink voor je team.
6. Verwijder vervolgens `ADMIN_SETUP_TOKEN` uit Render en sla de gewijzigde omgeving op. Het instellen is na stap 5 al definitief geblokkeerd, ook als de oude code nog bestaat.

**Teamleden kunnen geen beheerder worden.** De openbare instelpagina geeft zonder de geheime code geen toegang. Er kan maar één beheerdersaccount bestaan; een tweede aanmaakpoging wordt geweigerd. De uitnodigingslink is geen instelcode en geeft alleen deelnemersrechten.

Voortaan log je gewoon in met je e-mailadres en wachtwoord. Er is geen ChatGPT-login meer.

## 4. Eigen domein

1. Voeg bijvoorbeeld `planning.jouwbedrijf.nl` toe bij Render → Settings → **Custom Domains**.
2. Neem bij jouw domeinprovider precies de DNS-instelling over die Render toont.
3. Wacht tot Render het domein en HTTPS heeft geverifieerd.
4. Voeg in Render de omgevingsvariabele `APP_ORIGIN` toe, met bijvoorbeeld `https://planning.jouwbedrijf.nl` (geen pad erachter).
5. Sla op/herstart de service. Log op het nieuwe domein opnieuw in en kopieer daar de nieuwe uitnodigingslink.

`APP_ORIGIN` bepaalt vanaf welk websiteadres formulieren mogen worden verstuurd. Gebruik daarna dat adres. Oude links naar het vorige domein veranderen niet vanzelf.

## Wachtwoord wijzigen of herstellen

Als je bent ingelogd, kies onderaan **Wachtwoord wijzigen**. Je huidige wachtwoord is nodig. Andere sessies worden dan uitgelogd.

Ben je je wachtwoord vergeten?

1. Ga naar Render → Environment en bekijk de geheime `ADMIN_RECOVERY_TOKEN`. Dit is een andere code dan de instelcode.
2. Kies op de website **Wachtwoord vergeten?**.
3. Vul de herstelcode en een nieuw wachtwoord in.
4. De herstelcode is daarna verbruikt. Stel voor een volgende keer in Render een nieuwe, willekeurige geheime waarde van minstens 32 tekens in en herstart de service.

Gebruik voor nieuwe codes een wachtwoordmanager. Verstuur herstelcodes niet naar deelnemers en zet ze niet in GitHub. Er wordt geen herstelmail verzonden; herstel gaat via de eigenaar van het Render-account.

## Back-ups

Kies als beheerder onderaan **Back-up** om alle teamleden, weken en instellingen te downloaden. Bewaar dit JSON-bestand privé: het bevat teamgegevens en de uitnodigingscode. Het bestand bevat geen beheerderswachtwoord of ingelogde sessies.

Een technische beheerder kan een back-up op een lege database terugzetten met:

```
DATA_DIR=/var/data node scripts/restore.mjs /pad/naar/back-up.json
```

Stop invoer tijdens herstel en maak eerst een back-up van de bestaande database. Het script weigert gegevens te overschrijven. Je beheerdersaccount blijft apart bewaard. Browseropslag verhuist niet tussen domeinen: laat deelnemers hun persoonlijke link bewaren en wijzig bij een verhuizing alleen het domeindeel als de volledige database is overgezet.

## Lokaal controleren

Met Node.js 24:

```
npm ci
npm run check
npm test
npm run build
npm start
```

De website staat dan op `http://localhost:3000`. Voor de eerste beheerder zet je vooraf `ADMIN_SETUP_TOKEN` op een zelf gegenereerde geheime waarde van minstens 32 tekens. Het serverprogramma leest de procesomgeving; een `.env`-bestand wordt niet automatisch ingeladen. Gebruik lokaal nooit de codes uit productie.

## Geteste beveiliging

Automatische controles omvatten: instellen met een onjuiste code, blokkeren van een tweede beheerder, afscherming van het overzicht en back-ups, inloggen en uitloggen, wachtwoordherstel, sessies ongeldig maken, blokkeren van verzoeken van andere websites, begrenzen van inlogpogingen en gegevens bewaren na een herstart.

De Render-publicatie zelf moet nog in jouw account plaatsvinden. De lokale tests vervangen die eindcontrole niet.

## Officiële handleidingen

- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Permanente schijven](https://render.com/docs/disks)
- [Eigen domeinen](https://render.com/docs/custom-domains)
- [Render-webservices](https://render.com/docs/web-services)
