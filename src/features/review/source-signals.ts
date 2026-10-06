/**
 * Shared classification signals for lecture source text.
 *
 * This module holds the pattern vocabulary used to decide what in a lecture is
 * study content and what is not: bibliography, publication metadata,
 * affiliations, learning objectives, slide furniture and medical vocabulary.
 *
 * It has no dependencies on purpose, so both the cleaner and the fact
 * extractor can use the same rules without importing each other. Every
 * consumer shares these signals, so no generator grows its own private filter.
 */

/* ------------------------------------------------------------------ */
/* bibliography signals                                                */
/* ------------------------------------------------------------------ */

/** "13th ed.", "8th ed.", "6th Edition", "2nd edn" */
export const EDITION_RE = /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:ed\.?|edn\.?|edition|vol\.?|volume)\b/i;

/** Named publishing houses and the generic "… Press" form. */
export const PUBLISHER_NAME_RE =
  /\b(?:elsevier|springer|wiley|mcgraw[\s-]?hill|pearson|prentice[\s-]?hall|macmillan|thieme|blackwell|butterworth|saunders|mosby|manole|parthenon|lippincott|bailliere|oxford|cambridge|sage|academic|medical|health[\s-]sciences?)\b[^.]{0,40}?\b(?:press|publishers?|publishing|books?|ltd|inc|plc|gmbh|s\.?a)\b/i;
export const PUBLISHER_SUFFIX_RE = /\b(?:university\s+press|press|publishers?|publishing)\b/i;
/**
 * Imprint names that carry no "Press" word. Kept deliberately narrow: bare
 * place names such as "Oxford" or "Cambridge" are excluded because they also
 * occur in ordinary medical prose.
 */
export const PUBLISHER_BARE_RE =
  /\b(?:elsevier|springer|wiley|mcgraw[\s-]?hill|pearson|prentice[\s-]?hall|macmillan|thieme|blackwell|butterworth|saunders|mosby|manole|parthenon|lippincott|bailliere|oxford\s+university\s+press|cambridge\s+university\s+press|de\s+gruyter|karger|thieme)\b/i;

/** Publication places. Two or more in one line is bibliography-shaped. */
export const PLACE_RE =
  /\b(?:london|new\s+york|bombay|mumbai|delhi|new\s+delhi|panama|philadelphia|toronto|boston|chicago|edinburgh|manchester|glasgow|paris|berlin|madrid|moscow|tokyo|sydney|hong\s+kong|cairo|alexandria|durban|ibadan|karachi|calcutta|chennai|singapore|amsterdam|stockholm|copenhagen|geneva|vienna|zurich|milan|heidelberg)\b/i;

/** "Romanes, G. J.", "Snell, R.S.", "Moore, K. L." */
const AUTHOR_INITIALS_RE = /\b[A-Z][a-z]{2,}\s*,\s*(?:[A-Z]\.\s*){1,4}/;
const AUTHOR_INITIALS_TIGHT_RE = /\b[A-Z][a-z]{2,}\s+[A-Z]\.\s*[A-Z]\./;
const AUTHOR_PAIR_RE = /[A-Z][a-z]{2,}\s*,\s*(?:[A-Z]\.\s*){1,3}\s*(?:;|and|&|,)\s*[A-Z][a-z]{2,}\s*,/;
const ET_AL_RE = /\bet\s+al\.?\b/i;

const YEAR_PAREN_RE = /\((?:19|20)\d{2}[a-z]?\)/;
const YEAR_BARE_RE = /\b(?:19|20)\d{2}\b/;
const PAGE_MARK_RE = /\b(?:p{1,2}\.\s*\d+|pp\.?\s+\d+|pages?\s+\d+)\b/i;
const QUOTED_TITLE_RE = /["“”][^"“”]{6,}["“”]/;
const IDENTIFIER_RE = /\b(?:ISBN|DOI)\b\s*[:.]?\s*[\dx]/i;
/** "Anatomy for Students. Elsevier." — a title-cased run beside a publisher. */
const TITLE_RUN_RE = /\b[A-Z][a-z]+(?:\s+(?:of|for|and|the|by|in|on)\s+|\s+)(?:[A-Z][a-z]+\s*){0,6}/;

export type ReferenceSignals = {
  author: boolean;
  edition: boolean;
  publisher: boolean;
  year: boolean;
  places: boolean;
  page: boolean;
  quotedTitle: boolean;
  identifier: boolean;
};

export const referenceSignals = (t: string): ReferenceSignals => {
  const placeHits = t.match(new RegExp(PLACE_RE.source, "gi")) ?? [];
  return {
    author:
      AUTHOR_INITIALS_RE.test(t) ||
      AUTHOR_INITIALS_TIGHT_RE.test(t) ||
      AUTHOR_PAIR_RE.test(t) ||
      ET_AL_RE.test(t),
    edition: EDITION_RE.test(t),
    publisher: PUBLISHER_NAME_RE.test(t) || PUBLISHER_SUFFIX_RE.test(t) || PUBLISHER_BARE_RE.test(t),
    year: YEAR_PAREN_RE.test(t) || YEAR_BARE_RE.test(t),
    places: new Set(placeHits.map((p) => p.toLowerCase())).size >= 2,
    page: PAGE_MARK_RE.test(t),
    quotedTitle: QUOTED_TITLE_RE.test(t),
    identifier: IDENTIFIER_RE.test(t),
  };
};

/**
 * Generic bibliography detection.
 *
 * No book is hardcoded. A line counts as a reference when citation-shaped
 * signals combine: author initials, edition, publisher, year, publication
 * places, page marker, ISBN/DOI. One weak signal alone is not enough, so a
 * medical sentence that merely mentions a year survives filtering.
 */
export const looksLikeReference = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  const s = referenceSignals(t);
  if (s.identifier) return true;
  if (s.author && (s.edition || s.publisher || s.year || s.places || s.page || s.quotedTitle)) return true;
  if (s.edition && (s.publisher || s.places || s.year || s.author)) return true;
  if (s.publisher && (s.year || s.places || s.edition || s.author || s.quotedTitle || TITLE_RUN_RE.test(t))) return true;
  if (s.places && (s.year || s.edition || s.publisher)) return true;
  if (s.quotedTitle && (s.edition || s.year || s.publisher)) return true;
  if (s.page && (s.publisher || s.edition || s.author)) return true;
  return false;
};

/* ------------------------------------------------------------------ */
/* reference section headings                                          */
/* ------------------------------------------------------------------ */

export const REFERENCE_HEADING_RE =
  /^\s*(?:references?|bibliography|reference\s+list|works\s+cited|cited\s+(?:literature|sources)|recommended\s+(?:books?|reading|references?)|further\s+reading|suggested\s+(?:reading|books?)|books?\s+recommended|reading\s+list|selected\s+references?|key\s+references?|sources)\s*:?\s*$/i;
export const ARABIC_REFERENCE_HEADING_RE =
  /^\s*(?:المراجع|مراجع|المصادر|مصادر|قائمة المراجع|الكتب المرجعية|قراءات مقترحة)\s*:?\s*$/;

/** A short title-like line that can end a references block. */
export const CONTENT_HEADING_RE =
  /^\s*(?:\d+(?:\.\d+)*[.)]?\s+)?[A-Z][\p{L}][\p{L}\s'’\-/&]{2,60}\s*:?\s*$/u;

/* ------------------------------------------------------------------ */
/* metadata signals                                                    */
/* ------------------------------------------------------------------ */

export const METADATA_PATTERNS: RegExp[] = [
  // "Anatomy department", "Human Anatomy & Embryology Dept."
  /\b(?:department|dept\.?|faculty|division|unit)\s*(?:of\s+[\p{L}\s&'-]{2,40})?\s*$/iu,
  /\b(?:department|dept\.?|faculty|college|school|institute|academy)\s+of\b/i,
  // "Horus University in Egypt", "Cairo University"
  /\buniversity\b/i,
  /\b(?:staff\s+members?|teaching\s+staff|faculty\s+members?|lecturing\s+staff)\b/i,
  /^\s*by\s*:?\s*$/i,
  // Explicit credit lines
  /^\s*(?:prepared by|presented by|delivered by|compiled by|lecturer|instructor|professor|prof\.|dr\.|doctor|assistant professor|associate professor|taught by|supervised by|developed by|author|authored by|revised by|coordinator)\b\s*:?/i,
  /^\s*(?:prof\.|professor|dr\.|doctor|mr\.|ms\.|mrs\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s*$/i,
  // Arabic. The lookbehind is required: "قسم" is also the tail of the verb
  // "ينقسم" ("is divided"), which is study content, not a department line.
  /^\s*(?:أستاذ|دكتور|بروفيسور|استاذ|مدرس|محاضر)\s+[\u0600-\u06FF\s]{2,}$/u,
  /(?<![\p{L}])(?:جامعة|كلية|معهد|قسم|شعبة|قسم\s+علمي)\s+[\u0600-\u06FF]{2,}/u,
  /^\s*(?:إعداد|إشراف|تقديم)\s*:?\s*/u,
  // Contact details
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
];

/* ------------------------------------------------------------------ */
/* objective signals                                                   */
/* ------------------------------------------------------------------ */

/** "By the end of the lecture, the students will be able to:" */
export const OBJECTIVE_LEADIN_RE =
  /\b(?:by the end of (?:this |the )?(?:lecture|session|class|course|unit)|students?\s+will\s+be\s+able\s+to|learning\s+outcomes?|intended\s+outcomes?|course\s+outcomes?|objectives?|aims?\s+of\s+(?:this|the)\s+lecture|general\s+objectives?|specific\s+objectives?|competenc(?:y|ies)|intended\s+audience)\b/i;

/**
 * Administrative learning-objective verbs at the start of a line.
 *
 * These describe what the lecture covers rather than what the subject is, so
 * they must not become key concepts. Anchored at line start, and tolerant of
 * the OCR damage common in slide text ("Ientify Types of blood circulations").
 */
export const OBJECTIVE_VERB_RE =
  /^\s*(?:know|knows|knowledge\s+of|compare|compares|comparison\s+of|i\W{0,2}(?:d)?e?n?tify|identif(?:y|ies)|describe|describes|description\s+of|mention|mentions|discuss|discusses|understand|understands|recogni[sz]e|recogni[sz]es|outline|outlines|state|states|list|lists|define|defines|definition\s+of|explain|explains|illustrate|illustrates|analy[sz]e|apply|applies|summari[sz]e|differentiate|differentiates|distinguish|distinguishes|enumerate|conclude|concludes|locate|locates|sketch|draw\s+the|construct|appraise)\b/i;

/**
 * A list, sub-item or quiz marker in front of the real text.
 *
 * Extracted slides number everything ("5.", "IV-", "b)", "Q6-"), which hides the
 * signal the classifiers look for, so the marker is removed before the
 * objective and title tests run.
 */
export const LIST_PREFIX_RE = /^\s*(?:\d{1,3}|[IVXLC]{1,4}|[Qq]\.?\s?\d{1,3}|[A-Za-z])\s*[.)\-:–—]\s+/;

/**
 * A quiz item written into the lecture text.
 *
 * Pilot slides pasted into a lecture carry their own numbering ("Q1-", "Q6-")
 * and a question or a clinical vignette, none of which is a study fact.
 */
export const QUIZ_ITEM_RE = /^\s*Q\.?\s?\d{1,3}\s*[-–—.:)]/i;

/** Bare section labels: never a concept. */
export const LABEL_ONLY_RE =
  /^\s*(?:definition|definitions|introduction|overview|summary|conclusion|conclusions|note|notes|background|aim|aims|goal|goals|objective|objectives|learning|outcomes|contents|content|index|example|examples|remark|remarks|key\s*concepts?|key\s*points?|important\s*notes?)\s*:?\s*$/i;

/** "IL0-1", "ILO 2", "I.L.O.3": an intended-learning-objective marker. */
export const ILO_MARKER_RE = /^\s*I\.?\s?L\.?\s?O\.?\s*[-–—.:)\d]/i;

/* ------------------------------------------------------------------ */
/* medical signals                                                    */
/* ------------------------------------------------------------------ */

export const MEDICAL_TERMS = [
  "artery", "arteries", "arteriole", "arterioles", "vein", "veins", "venule", "venules",
  "capillary", "capillaries", "aorta", "cava", "pulmonary", "systemic", "portal", "coronary",
  "carotid", "jugular", "femoral", "brachial", "radial", "ulnar", "popliteal", "tibial",
  "hepatic", "splenic", "renal", "uterine", "iliac", "axillary", "subclavian", "cardiac",
  "myocardium", "myocardial", "endocardium", "pericardium", "pericardial", "atrium", "atria",
  "atrioventricular", "ventricle", "ventricles", "septum", "valve", "valves",
  "tricuspid", "bicuspid", "mitral", "aortic", "semilunar", "chordae", "papillary",
  "sinoatrial", "bundle", "myocard", "blood", "circulation", "circulatory", "haemoglobin",
  "hemoglobin", "erythrocyte", "erythrocytes", "leukocyte", "leukocytes", "lymphocyte",
  "lymphocytes", "neutrophil", "platelet", "platelets", "plasma", "oxygen", "oxygenated",
  "deoxygenated", "haemostasis", "hemostasis", "tissue", "tissues", "epithelium", "epithelial",
  "endothelium", "mesothelium", "basement", "cilia", "microvilli", "mucosa",
  "submucosa", "serosa", "cartilage", "bone", "bones", "skeleton", "skeletal", "periosteum",
  "marrow", "joint", "joints", "vertebra", "vertebrae", "disc", "ligament", "tendon", "muscle",
  "muscles", "muscular", "nerve", "nerves", "neuron", "neurons", "neurotransmitter", "receptor",
  "receptors", "synapse", "axon", "dendrite", "spinal", "cord", "brain", "cortex", "cerebellum",
  "medulla", "meninges", "dura", "arachnoid", "reflex", "gland", "glands", "liver", "kidney",
  "kidneys", "nephron", "glomerulus", "ureter", "urethra", "bladder", "lung", "lungs", "pleura",
  "pleural", "diaphragm", "trachea", "bronchus", "bronchi", "alveoli", "alveolar", "larynx",
  "pharynx", "oesophagus", "esophagus", "stomach", "duodenum", "jejunum", "ileum", "caecum",
  "cecum", "colon", "rectum", "pancreas", "spleen", "gallbladder", "ovary", "ovaries", "uterus",
  "fallopian", "testis", "testes", "testicle", "prostate", "skin", "epidermis", "dermis",
  "hypodermis", "sebaceous", "follicle", "thymus", "tonsil", "immunity", "immune",
  "antibody", "antibodies", "antigen", "phagocytosis", "inflammation", "tumour", "tumor",
  "carcinoma", "sarcoma", "lesion", "syndrome", "disease", "disorder", "infection", "necrosis",
  "ischaemia", "ischemia", "oedema", "edema", "fracture", "rupture", "hernia", "metabolism",
  "metabolise", "metabolize", "enzyme", "enzymes", "hormone", "hormones", "insulin", "glucagon",
  "glucose", "glycogen", "protein", "lipid", "membrane", "cytoplasm", "nucleus", "mitochondria",
  "ribosome", "organelle", "chromosome", "mitosis", "meiosis", "embryo", "embryonic", "fetal",
  "foetal", "foetus", "fetus", "pregnancy", "ovulation", "menstrual", "uteroplacental",
  "diagnosis", "symptom", "symptoms", "prognosis", "therapy", "treatment", "dose",
  "pressure", "secretion", "absorption", "filtration", "excretion", "metabolic", "hormonal",
  "cholesterol", "anemia", "anaemia", "carcinogen", "anaesthetic", "anesthetic", "injection",
];

export const MEDICAL_TERM_RE = new RegExp(`\\b(?:${MEDICAL_TERMS.join("|")})\\b`, "i");

/** Verbs that mark a statement as describing the subject rather than the document. */
export const MEDICAL_PHRASE_RE =
  /\b(?:acts? as|acts? a|carries|carry|pumps?|pumping|receives?|supplies?|transports?|separated|divided|located|consists? of|comprises|involves|flows?|flow|contracts?|relaxes?|secretes?|absorbs?|filters?|supplied|oxygenated|deoxygenated|returns?|empties? into|opens? into|passes? into|connected to|attached to|covered by|lined by|surrounded by|located between|responsible for|made up of)\b/i;

export const ARABIC_MEDICAL_RE =
  /(?:القلب|الشريان|الوريد|الدورة|الدموكالدم|الرئة|الكبد|الكلى|الكليتان|المعدة|الأمعاء|العصب|العصبون|العضلة|العضلات|العظم|العظام|النسيج|الخلية|التاج|التامور|الصمام|البطين|الأذين|الرئتان|المخ|النخاع|الضغط|ضغط\s+الدم|الدم|النزيف|الالتهاب|التهابات|الورم|الأورام|البطينين|الأذينين)/u;

/**
 * Biomedical morphology. Clinical vocabulary is far larger than any lexicon,
 * so recognise the suffix families a medical term always belongs to
 * ("pericarditis", "hypertrophy", "hyperplasia", "nephrectomy").
 */
export const BIOMEDICAL_SUFFIX_RE =
  /\b[A-Za-z]{4,}(?:itis|osis|ectomy|ostomy|tomy|emia|opathy|algia|megaly|penia|plasia|trophy|oma|uria|graphy|scopy|centesis|ptosis|cytosis|sclerosis|stenosis|rrhea|rhagia|plegia|paresis|genesis|trophy|secretion)\b/i;

/** Finite/linking verbs that turn a line into a statement of fact. */
const STATEMENT_VERB_RE =
  /\b(?:is|are|was|were|has|have|had|does|do|can|could|will|would|may|might|must|contains?|consist\w*|comprises?|occurs?|arises?|increas\w+|decreas\w+|means?|refers?|acts?|caus\w+|leads?|results?|carries|carry|pumps?|flows?|supplies?|receives?|transports?|separated|divid\w+|locat\w+|attached|connected|covered|lined|surrounded|responsible|performs?|allows?|enables?|provides?|produces?|formed|made|known|termed|called|present\w*|varies|depend\w*|includ\w+|measur\w+|control\w*|stimulat\w+|inhibit\w+|secret\w+|absorb\w+|filter\w+|metaboli\w+|differs?|classified|divided|distinguish\w*|involves)\b/i;

/** Arabic equivalents of the same "this is a statement" signal. */
const ARABIC_VERB_RE =
  /(?:هو|هي|يتم|تتم|يوجد|توجد|يحتوي|تحتوي|يشمل|تسبب|يسبب|يؤدي|يلي|يكون|تكو|ينقسم|يتكون|يمر|يمثل|يزيد|ينقص|يستقبل|يضخ|ينقل|ينتج|يعرف|يحدث|تحدث|تختلف|يتشابه|يستخدم|تستخدم|يعمل|يقوم|يعتمد|ينظم|يحافظ|يوفر|يوصل|يغذي|يخدم|يدخل|يخرج|يغلق|يفتح|ينشأ|تنشأ|يُعرف|تُعرف)/u;

/** True when a line reads as study content about the subject. */
export const isMedicalLine = (t: string): boolean => {
  if (t.trim().length < 12) return false;
  if (MEDICAL_TERM_RE.test(t)) return true;
  // Arabic lectures carry the same signal in Arabic vocabulary, so an Arabic
  // medical noun is enough on its own.
  if (ARABIC_MEDICAL_RE.test(t)) return true;
  if (BIOMEDICAL_SUFFIX_RE.test(t)) return true;
  if (MEDICAL_PHRASE_RE.test(t)) return true;
  // Last resort before UNKNOWN, and the guard against over-filtering: a
  // substantive statement of five or more words that reads as a fact is study
  // content even when its vocabulary is absent from every lexicon above
  // ("Hypertrophy differs from hyperplasia because the cell size changes.").
  // Reference, metadata, objective and furniture lines are classified before
  // this point, so widening here cannot reintroduce them.
  const words = t.trim().split(/\s+/).length;
  if (words >= 5 && (STATEMENT_VERB_RE.test(t) || ARABIC_VERB_RE.test(t))) return true;
  return false;
};

/**
 * Structural title test: short, no question, and carrying no predicate.
 *
 * A slide section title such as "Valves of the Heart" or "B. Heart" names a
 * medical structure without saying anything about it, so it is a heading even
 * though "valves" is a medical term. Content lines keep their predicate verb
 * ("Arteries: carry oxygenated blood to the tissues."), so they are unaffected.
 */
export const isTitleLike = (t: string): boolean => {
  const s = t.trim();
  if (!s) return true;
  if (s.split(/\s+/).length > 7) return false;
  if (/[?!؟]/.test(s)) return false;
  if (STATEMENT_VERB_RE.test(s) || ARABIC_VERB_RE.test(s) || MEDICAL_PHRASE_RE.test(s)) return false;
  return !/[.!?؟]$/.test(s);
};

/**
 * True for a short, title-like line ("Valves of the Heart", "B. Heart") that
 * is a label rather than a statement. Used so the UNKNOWN fallback in
 * `cleanedSource` cannot reintroduce a stray heading when a lecture has no
 * positively identified medical line.
 */
export const isHeadingShaped = (t: string): boolean => {
  if (LABEL_ONLY_RE.test(t)) return true;
  if (REFERENCE_HEADING_RE.test(t)) return true;
  if (looksLikeReference(t)) return true;
  return isTitleLike(t);
};

/* ------------------------------------------------------------------ */
/* header / footer / noise                                             */
/* ------------------------------------------------------------------ */

export const HEADER_PATTERNS: RegExp[] = [
  /^(?:module|موديول|unit|وحدة|lecture|محاضرة|chapter|فصل|week|أسبوع)\s+\d+/i,
  /^(?:lecture|محاضرة)\s+\d+/i,
  /^(?:week|أسبوع)\s+\d+/i,
  // Roman-numeral section titles ("I- Heart", "II- Blood Vessels"). Plain
  // numbered items are deliberately NOT headers: "1. The tricuspid valve
  // between the Rt. atrium and Rt. ventricle." is real study content.
  /^\s*[IVXLC]{1,4}\s*[-–—]\s*\S/,
  /^\s*[A-Z]\.\s+\d/i,
  /^\s*(?:overview|ملخص|summary|introduction|مقدمة|contents|فهرس|index)\b\s*:?/i,
];

export const FOOTER_PATTERNS: RegExp[] = [
  /^\s*(?:page|صفحة)\s+\d+/i,
  /^\s*\d+\s*\/\s*\d+\s*$/,
  /(?:©\s*\d{4}|copyright\s+\d{2,4}|all rights reserved|confidential|internal use only|for internal use|do not distribute)/i,
  /(?:جميع الحقوق محفوظة|الحقوق محفوظة|حقوق النشر)/,
];

export const NOISE_PATTERNS: RegExp[] = [
  /(?:LEAVE ME ALONE|leave me alone|DELETE THIS|REMOVE THIS|TODO:|FIXME:|XXX:|PLACEHOLDER)/i,
  /^\s*(?:slide|شريحة|الشريحة)\s*\d+\s*(?:#|number|no\.?|رقم|of|\/)?\s*\d*\s*$/i,
  /^\s*all rights reserved\.?\s*$/i,
];

/* ------------------------------------------------------------------ */
/* citation stripping                                                  */
/* ------------------------------------------------------------------ */

/**
 * Removes a citation suffix from a line that carries real medical content.
 *
 * Only strips when the parenthetical is unambiguously a citation (year, author,
 * edition, publisher), so genuine parentheses such as "(Rt. & Lt.)" survive.
 */
export const stripCitation = (line: string): string => {
  let t = line;

  const dropIfCitation = (m: string, inner: string) => {
    const s = referenceSignals(inner);
    return s.year || s.edition || s.author || s.publisher || s.quotedTitle ? " " : m;
  };

  // Trailing "(Author, 2010)" / "(2010)" / "(Smith et al., 2010; 13th ed.)"
  t = t.replace(/\s*\(([^()\[\]]{0,120})\)\s*$/, (m, inner: string) => dropIfCitation(m, inner));
  t = t.replace(/\s*\[([^()\[\]]{0,120})\]\s*$/, (m, inner: string) => dropIfCitation(m, inner));
  t = t.replace(/\s*\(([^()\[\]]{0,120})\)\s*(?=[.,;:]?\s*$)/, (m, inner: string) => dropIfCitation(m, inner));

  // Trailing page marker, e.g. "… Philadelphia. P. 253"
  t = t.replace(/\s*[,;.]?\s*\b(?:p{1,2}\.\s*\d+|pp\.?\s+\d+)\s*\.?\s*$/i, "");
  // Trailing " — Reference: X" / "- Ref: X"
  t = t.replace(/\s*[—–-]\s*(?:ref(?:erence)?|source|cit(?:ed|ation))\s*[:.].*$/i, "");

  // Removing a citation can leave "pump ." behind.
  t = t.replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
  return t;
};
