import React, { useEffect, useState, useMemo } from 'react';

// Significantly expanded fallback facts to ensure variety even without API updates
const FALLBACK_FACTS = [
  "The S1 heart sound is caused by the closure of the mitral and tricuspid valves.",
  "Atrial fibrillation increases the risk of stroke by approximately 5-fold.",
  "Beck's Triad for Cardiac Tamponade: Hypotension, JVD, and muffled heart sounds.",
  "Aortic stenosis typically presents with a harsh, crescendo-decrescendo systolic murmur.",
  "Hyperkalemia on ECG: Peaked T waves, prolonged PR, widened QRS, sine wave.",
  "Pulsus Paradoxus (drop in SBP >10mmHg on inspiration) is a hallmark of Cardiac Tamponade.",
  "Charcot's Triad for Cholangitis: Fever, RUQ Pain, and Jaundice.",
  "The liver synthesizes albumin, bile, and clotting factors (II, VII, IX, X).",
  "Helicobacter pylori is the main cause of peptic ulcers and MALT lymphoma.",
  "Type 1 Diabetes is caused by autoimmune destruction of beta cells.",
  "Iron Deficiency Anemia: Microcytic, Low Ferritin, High TIBC, Low Saturation.",
  "Broca's area (Frontal lobe) controls motor speech; damage causes expressive aphasia.",
  "Cushing's Triad for increased ICP: Hypertension, Bradycardia, Irregular respirations.",
  "Virchow's Triad for Thrombosis: Stasis, Hypercoagulability, Endothelial damage.",
  "Kawasaki Disease diagnostic criteria: CRASH and Burn (Conjunctivitis, Rash, Adenopathy, Strawberry tongue, Hands/feet, Fever).",
  "Metformin should be withheld before contrast procedures due to lactic acidosis risk.",
  "The most common cause of community-acquired pneumonia is Streptococcus pneumoniae.",
  "HLA-B27 is strongly associated with Ankylosing Spondylitis.",
  "Target cells are commonly seen in Thalassemia and Liver disease.",
  "Auer rods are pathognomonic for Acute Myeloid Leukemia (AML).",
  "Reed-Sternberg cells ('Owl eyes') are characteristic of Hodgkin Lymphoma.",
  "Gout crystals are needle-shaped and negatively birefringent (yellow when parallel).",
  "Pseudogout crystals are rhomboid-shaped and positively birefringent (blue when parallel).",
  "Murphy's Sign is indicative of Acute Cholecystitis (inspiratory arrest on RUQ palpation).",
  "McBurney's Point tenderness is the classic sign of Appendicitis.",
  "Courvoisier's Sign: Palpable, non-tender gallbladder suggests pancreatic cancer.",
  "Trousseau's Sign (carpopedal spasm) indicates Hypocalcemia.",
  "Chvostek's Sign (facial twitch) indicates Hypocalcemia.",
  "Diabetes Insipidus presents with polyuria and polydipsia due to ADH deficiency or resistance.",
  "Pheochromocytoma triad: Palpitations, Headache, Episodic sweating (PHE).",
  "Addison's Disease presents with hyperpigmentation, hypotension, and hyperkalemia.",
  "Graves' Disease is the most common cause of hyperthyroidism (TSH receptor antibodies).",
  "Hashimoto's Thyroiditis is the most common cause of hypothyroidism (Anti-TPO antibodies).",
  "Myasthenia Gravis involves antibodies against postsynaptic ACh receptors (worsens with use).",
  "Lambert-Eaton Syndrome involves antibodies against presynaptic Ca channels (improves with use).",
  "Guillain-Barre Syndrome usually follows a GI (Campylobacter) or respiratory infection.",
  "Multiple Sclerosis is a demyelinating disease of the CNS (Oligoclonal bands in CSF).",
  "Parkinson's Disease involves loss of dopaminergic neurons in the Substantia Nigra.",
  "Wilson's Disease is characterized by copper accumulation and Kayser-Fleischer rings.",
  "Scurvy is caused by Vitamin C deficiency (gum bleeding, corkscrew hairs).",
  "Pellagra (Vitamin B3 deficiency) presents with the 3 Ds: Diarrhea, Dermatitis, Dementia.",
  "Beriberi (Vitamin B1 deficiency): Dry (neuro) vs Wet (cardiac).",
  "Wernicke's Encephalopathy triad: Confusion, Ophthalmoplegia, Ataxia (Thiamine def).",
  "Folate deficiency causes megaloblastic anemia without neurologic symptoms.",
  "Vitamin B12 deficiency causes megaloblastic anemia WITH neurologic symptoms.",
  "Digoxin toxicity typically presents with yellow-tinted vision (Xanthopsia).",
  "Acetaminophen toxicity depletes glutathione; treatment is N-acetylcysteine.",
  "Opioid overdose triad: Coma, Pinpoint pupils (miosis), Respiratory depression.",
  "Benzodiazepine overdose is treated with Flumazenil (use with caution).",
  "Beta-blocker overdose is treated with Glucagon.",
  "Sarcoidosis typically presents with bilateral hilar lymphadenopathy on CXR.",
  "Silicosis shows 'eggshell calcification' of hilar lymph nodes.",
  "Asbestosis affects the lower lobes; Silicosis/Coal affect the upper lobes.",
  "Legionella pneumonia is associated with hyponatremia and GI symptoms.",
  "Mycoplasma pneumonia is associated with cold agglutinins and bullous myringitis.",
  "Pneumocystis jirovecii (PCP) appears as diffuse interstitial infiltrates in HIV patients.",
  "Currant jelly sputum is characteristic of Klebsiella pneumoniae.",
  "Rust-colored sputum is characteristic of Streptococcus pneumoniae.",
  "Lead poisoning often presents with basophilic stippling on smear and Burton lines on gums.",
  "Hemophilia A is Factor VIII deficiency; Hemophilia B is Factor IX deficiency.",
  "Von Willebrand Disease is the most common inherited bleeding disorder.",
  "Warfarin acts by inhibiting Vitamin K epoxide reductase (affects II, VII, IX, X, C, S).",
  "Heparin acts by activating Antithrombin III.",
  "Disseminated Intravascular Coagulation (DIC) causes prolonged PT, PTT, and low platelets.",
  "Thrombotic Thrombocytopenic Purpura (TTP) pentad: FAT RN (Fever, Anemia, Thrombocytopenia, Renal, Neuro).",
  "Plummer-Vinson Syndrome triad: Dysphagia, Iron deficiency anemia, Esophageal webs.",
  "Mallory-Weiss tears are longitudinal mucosal lacerations at the GE junction (alcoholics).",
  "Boerhaave Syndrome is a transmural esophageal rupture (surgical emergency).",
  "Whipple's Disease triad: Cardiac symptoms, Arthralgias, Neurologic symptoms (CAN)."
];

interface LoadingProps {
  message: string;
  customFacts?: string[];
}

export const Loading: React.FC<LoadingProps> = ({ message, customFacts }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  
  // FIX: Use useMemo so this array reference is STABLE across renders.
  // Without useMemo, this creates a new array every second (when elapsedSeconds updates),
  // causing the useEffect below to re-run, resetting the timer and picking a new fact instantly.
  const factsToUse = useMemo(() => {
    return (customFacts && customFacts.length > 0) 
      ? [...customFacts, ...FALLBACK_FACTS] 
      : FALLBACK_FACTS;
  }, [customFacts]);

  useEffect(() => {
    // Initial random selection
    setFactIndex(Math.floor(Math.random() * factsToUse.length));

    const startTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      setElapsedSeconds(diff);
    }, 1000);

    // Rotate facts every 15 seconds (Fixed as requested)
    const factInterval = setInterval(() => {
      setFactIndex((prevIndex) => {
        let newIndex;
        // Ensure we pick a DIFFERENT fact than the current one
        // Try up to 10 times to get a unique one
        let attempts = 0;
        do {
          newIndex = Math.floor(Math.random() * factsToUse.length);
          attempts++;
        } while (newIndex === prevIndex && factsToUse.length > 1 && attempts < 10);
        return newIndex;
      });
    }, 15000); // 15 seconds strict

    return () => {
      clearInterval(interval);
      clearInterval(factInterval);
    };
  }, [factsToUse]);

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center w-full max-w-md mx-auto animate-in fade-in duration-700">
      <div className="w-16 h-16 mb-6 text-blue-500 animate-spin">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
      
      <h3 className="text-lg font-bold text-slate-800 mb-2">{message}</h3>
      <p className="text-sm text-slate-500 mb-8 font-mono bg-slate-100 px-3 py-1 rounded-full">
        Time Elapsed: {elapsedSeconds}s
      </p>

      {/* Medical Fact Card */}
      <div className="bg-white border border-blue-100 rounded-xl p-6 shadow-sm max-w-sm w-full relative overflow-hidden min-h-[8rem] flex flex-col">
        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
        <p className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-3 text-left">High-Yield Pearls</p>
        <div className="flex-1 flex items-center justify-center">
          <p key={factIndex} className="text-slate-700 text-sm font-medium animate-in fade-in slide-in-from-right-4 duration-500 leading-relaxed text-left">
            "{factsToUse[factIndex]}"
          </p>
        </div>
      </div>
      
      <div className="mt-8 flex gap-2 justify-center">
        <div className="w-2 h-2 rounded-full bg-slate-300 animate-bounce delay-0"></div>
        <div className="w-2 h-2 rounded-full bg-slate-300 animate-bounce delay-150"></div>
        <div className="w-2 h-2 rounded-full bg-slate-300 animate-bounce delay-300"></div>
      </div>
    </div>
  );
};