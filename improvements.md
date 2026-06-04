# Code review — go-pretty-preview

> **Fókusz:** stabilitás + fejleszthetőség (tesztelhetőség).
> A repó célja: AI-generált Go kódtömegek gyorsabb review-zása. Az alábbiak ehhez igazítva, prioritás szerint.

---

## A két nagy kérdésre röviden

**tree-sitter: jó döntés volt, és nagyrészt jól is van bekötve.** Pont azokat a regex/brace-számláló törékenységeket szünteti meg, amiket a `use-valid-parser.md` is felsorolt, és a migráció megtörtént (a transzformerek már `Tree`-t kapnak). A grammatika is ellenőrizve: a `blockStmtCount` feltételezése (`block → statement_list → statements`) **helyes** ennél a verziónál. A választás és az alapbekötés rendben — **viszont alulhasznált, és van benne 2-3 konkrét hiba** (lentebb).

**Shiki → tree-sitter renderelés (eldöntött irány, lásd lentebb).** Korábban a Shiki megtartása mellett érveltem a *téma-hűség* miatt („nézzen ki, mint a szerkesztőd"). De a termékcél ennek az ellenkezője: a preview *látszódjon is* read-only nézetnek, ne egy második editornak. Ezzel a céllal a téma-hűség nem-cél, a megkülönböztető kinézet pedig feature → áttérünk tree-sitter highlight-queryre. Részletek a „Döntés: renderelés" szakaszban.

---

## Döntés: renderelés tree-sitterrel + megkülönböztető téma

**Irány:** a megjelenítés Shikiről tree-sitter highlight-queryre vált. A preview szándékosan *más* kinézetű, mint a szerkesztő — ez jelzi, hogy read-only nézet.

**Miért:**
- **Pontosabb hover / ctrl+click.** A token-pozíciók közvetlenül az AST node-okból jönnek → eltűnik a `media/preview.js:23` (`colOf`) DOM-bejárós heurisztikája és a col-0 fallback a collapsed sorokon.
- **Egy parser, egy igazságforrás.** A tree-sitter úgyis kell a struktúrához; a Shiki eldobásával valódi MB-megtakarítás és megszűnik a kettős parser.
- **A dekorációk query-vé válnak.** A mostani `packageDecorations.ts` regex + kézi string/komment-kizárás lecserélhető egy `selector_expression` query-re; a jövőbeli struct-tag / context-param halványítás ugyanígy egy-egy query.

**Amit meg kell oldani (kicsi, és mi uraljuk):**
- **2 paletta (sötét/világos),** ~20 capture-csoportra × 2 — nem több száz scope-ot egyeztetünk, hanem két kézzel hangolt palettát írunk. A sötét/világos detektálás már megvan (`vscode.window.activeColorTheme.kind`).
- Kis token→HTML renderer + Go `highlights.scm` query (adaptálható a tree-sitter-go / nvim-treesitter forrásból) + CSS a capture-osztályokhoz.

**Következmény — a kimenet mindig érvényes Go:** mivel tree-sitterrel renderelünk, a megjelenített szövegnek parse-olhatónak kell lennie. Ezért a „kapcsos zárójel elhagyása" kiesik (lásd inline-if lentebb), és minden transzformer kimenete valid Go marad.

### Két-tengelyes modell (a string→string átírás helyett)
- **Láthatóság:** `keep` / `fade` / `delete` — a zaj-szabályokra. `delete` = sorok kivétele + lineMap újraszámozás; `fade` = dekoráció, a sor marad. Mindkettő valid Go-t hagy.
- **Reflow:** összevonás-e (jelenleg csak az inline-if). Ez nem „eltüntet", hanem több sort egy *valid Go* sorba folyat át. A megmaradt kapcsosok a `fade` ágra esnek.

Ez természetesen párosul a descriptor-alapú pipeline-refaktorral (lásd Fejleszthetőség / 1): minden output-sor `{ sourceLine, text, faded?, collapsed?, colMap? }`.

---

## Stabilitás — konkrét hibák, prioritás szerint

### 1. 🔴 WASM memóriaszivárgás (a legfontosabb)
Sehol nincs `tree.delete()` hívás. A `ParserService.parse` minden híváskor új WASM-tree-t allokál; a `runTransformers` minden kódváltozás után újraparse-ol (`src/transformers/index.ts:41-47`); a `finalTree` a dekorációk után eldobódik. tree-sitterben a `Tree` a WASM-heapen él, és kézzel kell felszabadítani (`tree.delete` létezik). Hosszú szerkesztési munkamenetben — ami pont a use-case — a heap folyamatosan nő.

**Fix:** a `ParserService` adjon „parse-and-use" mintát, vagy a hívó feleljen a `delete`-ért; a köztes fákat és a `finalTree`-t fel kell szabadítani használat után.

### 2. 🔴 Érvénytelen kód szerkesztés közben nincs kezelve
Sehol nincs `rootNode.hasError()` ellenőrzés. Az élő preview lényege, hogy gépelés közben frissül — ilyenkor a kód gyakran fél-érvényes, és a tree-sitter `ERROR` node-okat ad. Az if-felismerés ettől félremehet vagy a transzformáció eltűnik/villog.

**Fix:** legalább részfa-szintű degradálás (ERROR-os subtree kihagyása, nem az egész fájl).

### 3. 🟡 Async race dokumentum-/editorváltáskor
A `GoPreviewProvider.pushUpdate` async (parse + highlighter). Ha közben editort váltasz, egy „elkésett" update felülírhatja a `currentLineMap`/`currentDocUri`-t a régi doksi adataival → a diagnostics/scroll mapping rossz dokumentumra mutat.

**Fix:** generációs token (sorszám, amit a render végén ellenőrzöl, mielőtt a panelre posztolsz).

### 4. 🟡 Felesleges teljes újraparse minden transzformer után
`src/transformers/index.ts:41-47` — most 2 transzformerrel elhanyagolható, de a tervezett ~10 szabállyal ez minden billentyűleütésnél N teljes újraparse. Inkrementális parse nincs (pedig `parser.parse(src, oldTree)` működik). Ezt érdemes inkább az architektúrán keresztül megoldani (lásd Fejleszthetőség / 1).

### 5. 🟡 inlineOneLineIf fejléc-rekonstrukció szöveges
`src/transformers/inlineOneLineIf.ts:166-169` — regexszel vágja le a `{`-et a sor végéről. `if x { // komment` esetén a regex nem illeszkedik (a sor `// komment`-re végződik), és a komment beragad a fejlécbe. Megvan a `tree`, használható helyette a `condition` node szövege — itt az AST alulhasznált.

**Kapcsos zárójelek (eldöntött):** a kimenet `if err != nil { return err }` formájú lesz (valid Go, a tree-sitter renderelés feltétele). A kapcsosokat **nem távolítjuk el**, hanem `opacity: 0.3`-ra halványítjuk, szürkítés nélkül — ott vannak (parse-olható, copy-paste fordítható), de a szem átsiklik rajtuk. A zaj-csökkentés döntő része amúgy is a sorösszevonásból jön (több sor → 1 sor), nem a 2 karakter eltüntetéséből.

---

## Fejleszthetőség

### 1. 🟠 A pipeline string→string + minden lépésnél újraparse — ez a fő „adó"
Minden transzformer kézzel görgeti a `lineMap`-et, és a `runTransformers` (`src/transformers/index.ts:52-54`) komponálja. Minden új szabálynál újra meg kell írni ezt a könyvelést, hibára hajlamosan.

**Javaslat:** strukturált „output-sor descriptor" modell — egy lista, ahol minden elem `{ sourceLine, text, faded?, highlighted?, collapsed?, colMap? }`. Egy `Tree` az *eredeti* forrásról; a transzformerek descriptor-listát annotálnak/írnak át, nem stringet. Eredmény: nincs köztes újraparse (és onnan szivárgás), a `lineMap` automatikusan adódik, és a tervezett szabályok (import-fold, struct-tag, defer-dimm) olcsók lesznek. Ez a legnagyobb tőkeáttétel a „jövőbeli feature-ök támogatása" célra.

### 2. 🟡 Decoration vs. transformer kettősség nincs egységesítve
A `buildPackageDecorations` (`src/packageDecorations.ts:53`) egyszeri függvény, nem plugin. Az oszlopszintű effektek (struct-tag, `context.Context`-param halványítás) ugyanilyen szerkezetűek lesznek → érdemes egy `DecorationProvider` interfész a `Transformer` mellé, hogy ezeknek is legyen pluginezhető helyük.

### 3. 🟠 Tesztelhetőség (most ez a leggyengébb pont)
A transzformerek már *majdnem* tiszta függvények (jó: a config-olvasás kívül van, ezt a `types.ts:20-25` doc is leírja). De:

- A `ParserService` (`src/ParserService.ts:1-12`) **importálja a vscode-ot** (OutputChannel) és `__dirname`-re épül → unit-tesztben nem példányosítható, így a transzformerek teszteléséhez sincs könnyű `Tree`.
- A `buildPackageDecorations` (`src/packageDecorations.ts:54`) **a függvényen belül olvas configot** — pont az az anti-pattern, amit a transzformereknél elkerültetek. A hívó adja át `packages: string[]`-ként.

**Javaslat:** `src/core/` (vscode-mentes: parser-factory, transzformerek, decorations) + `src/vscode/` (provider, config-olvasás, gopls-bridge) szétválasztás, plusz egy `parseGo(src): Tree` teszt-helper. Ezzel a transzformerek és a decoration-logika vscode-mock nélkül tesztelhetők — pont a „ha akarom, könnyű legyen" célra.

### 4. 🟢 AST továbbra is alulhasznált a hover/go-to-def-nél
A collapsed sorokon a `sourcePosOf` (`media/preview.js:48`) col 0-ra esik vissza. Az AST node-pozíciókból kiadható lenne egy karakter-szintű `colMap` — ez a descriptor-modellbe (1. pont) természetesen illeszkedne.

---

## Apróságok
- `web-tree-sitter@0.26` / `tree-sitter-go@0.25` — érdemes pontos verzióra pinnelni (WASM ABI-kompatibilitás).
- A `Makefile` rendben van, de az `improvement.md` még hibásként hivatkozik rá — frissítendő.
- CI jó (typecheck + lint + build); a tesztlépés majd ide jön be.
- `.vscodeignore` rendben: az `out/` (bundle + `.wasm`) bekerül a VSIX-be.

---

## Javasolt sorrend (a két fókuszra hangolva)

1. **Stabilitás-csomag** (kicsi, magas haszon): `tree.delete()` + `hasError()` degradálás + async generációs token.
2. **Tesztelhetőségi szétválasztás** (`core/` vs `vscode/`, config kivezetése a decoration-ból, `parseGo` helper) — utána bármit lehet tesztelni.
3. **Descriptor-alapú pipeline** (a köztes újraparse és a kézi `lineMap` megszüntetése) — ez nyitja meg olcsón a jövőbeli szabályokat.
