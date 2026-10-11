export enum CategoryType {
  INTERNAL_MEDICINE = 'Internal Medicine',
  OTHER = 'Other Specialties',
  PHARMACOLOGY = 'Pharmacology' // New Category
}

export enum Language {
  KOREAN = 'Korean',
  ENGLISH = 'English',
  JAPANESE = 'Japanese'
}

export enum StudyLength {
  SHORT = 'Under 1 min',
  MEDIUM = '1-3 mins',
  DETAILED = 'Deep Dive'
}

export enum SubCategory {
  INTERNAL_MEDICINE_GENERAL = 'Internal Medicine (All)', // Added generic IM option
  CARDIOLOGY = 'Cardiology', // Main interest
  PULMONOLOGY = 'Pulmonology',
  GASTROENTEROLOGY = 'Gastroenterology',
  NEPHROLOGY = 'Nephrology',
  ENDOCRINOLOGY = 'Endocrinology',
  INFECTIOUS_DISEASE = 'Infectious Disease',
  RHEUMATOLOGY = 'Rheumatology',
  HEMATOLOGY_ONCOLOGY = 'Hematology/Oncology',
  CRITICAL_CARE_MEDICINE = 'Critical Care Medicine',
  ALLERGY = 'Allergy & Immunology', // Added Allergy
  
  // Others
  PRIMARY_CARE = 'Primary Care (Family Medicine)', // Added Primary Care
  GENERAL_SURGERY = 'General Surgery',
  ORTHOPEDICS = 'Orthopedics',
  PLASTIC_SURGERY = 'Plastic Surgery',
  OPHTHALMOLOGY = 'Ophthalmology',
  DERMATOLOGY = 'Dermatology',
  OTOLARYNGOLOGY = 'Otolaryngology (ENT)',
  PEDIATRICS = 'Pediatrics',
  OBGYN = 'OB/GYN',
  NEUROLOGY = 'Neurology',
  PSYCHIATRY = 'Psychiatry',
  EMERGENCY_MEDICINE = 'Emergency Medicine',
  RADIOLOGY = 'Radiology', // Added Radiology
  BASIC_PHYSIOLOGY = 'Basic Physiology',
  MEDICAL_STATISTICS = 'Medical Statistics & EBM', // Added Statistics
  PHARMACOLOGY = 'Clinical Pharmacology', // New SubCategory
  
  // Special selections
  OTHER_GENERAL = 'Any Other Specialty', // Consolidated choice
  RANDOM = 'Random Selection'
}

export interface Source {
  title: string;
  uri: string;
}

// One O/X statement used for spaced-repetition recall of a card
export interface RecallQuestion {
  statement: string;
  isTrue: boolean;
  explanation: string;
}

// Spaced-repetition state for a card's recall question
export interface ReviewState {
  stage: number;          // index into REVIEW_INTERVALS_DAYS
  dueAt: number | null;   // ms timestamp; null = finished
  lastAnsweredAt?: number;
  correct: number;
  wrong: number;
}

export interface SeriesPart {
  title: string;
  focus: string;
  cardId?: string;        // set once this part has been generated and read
}

export interface Series {
  id: string;
  title: string;          // display title in the chosen language
  theme: string;          // what the user typed
  specialty?: string;
  language: Language;
  length: StudyLength;
  parts: SeriesPart[];
  createdAt: number;
  updatedAt: number;
}

export interface StudyContent {
  id?: string;
  createdAt?: number;
  readAt?: number;        // set when first shown; saved cards always have it
  specialty?: string;     // SubCategory value
  language?: Language;
  length?: StudyLength;
  keyPoints?: string[];   // 2-3 one-line takeaways (used for history + series context)
  recall?: RecallQuestion;
  review?: ReviewState;
  seriesId?: string;
  seriesIndex?: number;
  seriesTitle?: string;
  title: string;
  content: string; // Markdown formatted text
  sources: Source[];
  topic: string;
  suggestedTopics?: string[]; // New: List of related keywords for next study
  imageQueries?: string[]; // English search terms for real images (Open-i / Wikimedia Commons)
  flowchart?: string; // Optional Mermaid flowchart source for algorithms/pathways
}

export interface MedicalImage {
  thumb: string;      // thumbnail URL shown in the grid
  full: string;       // larger image URL shown when tapped
  caption: string;    // figure caption / description
  sourceTitle: string; // article title or file title
  sourceUrl: string;  // page to open for the original
  license?: string;   // license label if known
  provider: 'Open-i' | 'Wikimedia Commons';
}

export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}