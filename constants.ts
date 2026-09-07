import { CategoryType, SubCategory } from './types';

export const CATEGORY_MAP: Record<CategoryType, SubCategory[]> = {
  [CategoryType.INTERNAL_MEDICINE]: [
    SubCategory.INTERNAL_MEDICINE_GENERAL, // Added generic option
    SubCategory.CARDIOLOGY,
    SubCategory.PULMONOLOGY,
    SubCategory.GASTROENTEROLOGY,
    SubCategory.NEPHROLOGY,
    SubCategory.ENDOCRINOLOGY,
    SubCategory.INFECTIOUS_DISEASE,
    SubCategory.RHEUMATOLOGY,
    SubCategory.HEMATOLOGY_ONCOLOGY,
    SubCategory.CRITICAL_CARE_MEDICINE,
    SubCategory.ALLERGY, // Added Allergy
  ],
  [CategoryType.OTHER]: [
    SubCategory.OTHER_GENERAL, // Added generic option
    SubCategory.PRIMARY_CARE, // Added Primary Care
    SubCategory.GENERAL_SURGERY,
    SubCategory.ORTHOPEDICS,
    SubCategory.PLASTIC_SURGERY,
    SubCategory.OPHTHALMOLOGY,
    SubCategory.DERMATOLOGY,
    SubCategory.OTOLARYNGOLOGY,
    SubCategory.PEDIATRICS,
    SubCategory.OBGYN,
    SubCategory.NEUROLOGY,
    SubCategory.PSYCHIATRY,
    SubCategory.EMERGENCY_MEDICINE,
    SubCategory.RADIOLOGY, // Added Radiology
    SubCategory.BASIC_PHYSIOLOGY,
  ],
  [CategoryType.PHARMACOLOGY]: [
    SubCategory.PHARMACOLOGY
  ]
};

export const DEFAULT_CATEGORY = SubCategory.CARDIOLOGY;