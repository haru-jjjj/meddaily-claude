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

export interface StudyContent {
  title: string;
  content: string; // Markdown formatted text
  sources: Source[];
  topic: string;
  suggestedTopics?: string[]; // New: List of related keywords for next study
}

export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}