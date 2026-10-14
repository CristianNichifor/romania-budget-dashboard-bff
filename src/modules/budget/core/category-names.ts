/**
 * transparenta.eu serves the budget classification names without
 * diacritics ("Pensii si ajutoare pentru batrinete"). This map restores the
 * official spelling for the functional and economic categories the
 * dashboard shows most; unknown names pass through unchanged. Keys are the
 * upstream names with runs of spaces collapsed.
 */
const KNOWN_NAMES: Record<string, string> = {
  // Functional classification
  "Pensii si ajutoare pentru batrinete": "Pensii și ajutoare pentru bătrânețe",
  "Tranzactii privind datoria publica si imprumuturi":
    "Tranzacții privind datoria publică și împrumuturi",
  "Transferuri din bugetul de stat catre bugetul asigurarilor sociale de stat":
    "Transferuri din bugetul de stat către bugetul asigurărilor sociale de stat",
  "Drumuri si poduri": "Drumuri și poduri",
  "Autoritati executive": "Autorități executive",
  "Asistenta sociala pentru familie si copii":
    "Asistență socială pentru familie și copii",
  "Aparare nationala": "Apărare națională",
  "Asistenta sociala in caz de invaliditate":
    "Asistență socială în caz de invaliditate",
  "Alte cheltuieli in domeniul agriculturii, silviculturii, pisciculturii si vanatorii":
    "Alte cheltuieli în domeniul agriculturii, silviculturii, pisciculturii și vânătorii",
  "Alte servicii in domeniile locuintelor, serviciilor si dezvoltarii comunale":
    "Alte servicii în domeniile locuințelor, serviciilor și dezvoltării comunale",
  "Cofinantarea fondurilor primite de la Uniunea Europeana":
    "Cofinanțarea fondurilor primite de la Uniunea Europeană",
  "Alte institutii si actiuni sanitare": "Alte instituții și acțiuni sanitare",
  "Contributia la bugetul U E": "Contribuția la bugetul UE",
  "Invatamant secundar inferior": "Învățământ secundar inferior",
  "Alte cheltuieli in domeniul invatamantului":
    "Alte cheltuieli în domeniul învățământului",
  "Transport pe calea ferata": "Transport pe calea ferată",
  "Alte cheltuieli in domeniul agriculturii":
    "Alte cheltuieli în domeniul agriculturii",
  // Economic classification
  "Asigurari sociale": "Asigurări sociale",
  "Ajutoare sociale in numerar": "Ajutoare sociale în numerar",
  "Salarii de baza": "Salarii de bază",
  "Materiale si prestari de servicii cu caracter functional":
    "Materiale și prestări de servicii cu caracter funcțional",
  "Sporuri pentru conditii de munca": "Sporuri pentru condiții de muncă",
  "Masini, echipamente si mijloace de transport":
    "Mașini, echipamente și mijloace de transport",
  "Alte bunuri si servicii pentru intretinere si functionare":
    "Alte bunuri și servicii pentru întreținere și funcționare",
  "Dobanzi aferente datoriei publice interne directe":
    "Dobânzi aferente datoriei publice interne directe",
  Constructii: "Construcții",
  "Finantare nationala": "Finanțare națională",
  "Finantare publica nationala": "Finanțare publică națională",
  "Finantare externa nerambursabila": "Finanțare externă nerambursabilă",
  "Fonduri din imprumut rambursabil": "Fonduri din împrumut rambursabil",
  "Intretinerea infrastructurii rutiere":
    "Întreținerea infrastructurii rutiere",
  "Alte drepturi salariale in bani": "Alte drepturi salariale în bani",
  "Fond aferent platii cu ora": "Fond aferent plății cu ora",
  "Indemnizatii platite unor persoane din afara unitatii":
    "Indemnizații plătite unor persoane din afara unității",
  "Pregatire profesionala": "Pregătire profesională",
  "Actiuni de sanatate": "Acțiuni de sănătate",
};

export function normalizeCategoryName(name: string): string {
  const key = name.replace(/\s+/g, " ").trim();
  return KNOWN_NAMES[key] ?? name;
}
