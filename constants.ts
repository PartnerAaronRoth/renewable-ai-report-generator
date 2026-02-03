
export const SOURCE_TYPE_DEFINITIONS_PROMPT = `
You are an expert document analyzer for a construction/energy dataroom. 

CRITICAL INSTRUCTION:
Scan the ENTIRE content of the provided document. 
Your task is to identify the **PRIMARY** "Document Type" of this file.

STRICT CLASSIFICATION RULES:
1. **ONE TYPE ONLY**: Assign a maximum of 1-2 types. Do NOT list every section found in the Table of Contents.
2. **CONTAINER RULE**: If a document is a "Construction Contract" that happens to have "Insurance Certs" and "Scope of Work" attached as exhibits at the back, it is STILL just a "Construction Contract". Do NOT tag the exhibits as separate types unless they are the *only* content of the file.
3. **CONTENT OVER REFERENCE**: Only assign a type if the file contains the *actual content*. If a contract merely *mentions* "Title Insurance", do NOT tag it as Title Insurance.
4. **PROPOSAL PRIORITY**: If the document is a "Proposal", "Technical Proposal", or "Executed Proposal", classify it as "Executed Proposal" or "Technical Proposal".

Valid Document Types (Select best match):
- Lease Agreements or Land Acquisition Agreements
- Full / Partial Deed of Reconveyance
- Title Insurance
- Zoning / CUP / Permits
- ALTA Survey / Topo Survey
- Environmental Report (Phase I/II)
- Geotechnical Report
- Flood / Wetland Study
- Decommissioning Bond
- Interconnection Agreement (IX)
- Power Purchase Agreement (PPA)
- Construction Contract (EPC)
- O&M Agreement
- Asset Management Agreement
- Structural Drawings / Specs
- Electrical Drawings / Specs
- Civil Drawings / Specs
- Mechanical Drawings / Specs
- Solar Module Specs / Warranty
- Inverter Specs / Warranty
- Racking Specs / Warranty
- BESS Specs / Warranty
- Transformer / BOS Specs
- Energy Model / PVSyst
- Insurance Certificate (COI)
- Financial Model / Budget
- Schedule (CPM)
- Company History / Resumes / Org Chart
- Safety Program / QAQC Manual
- Independent Engineering (IE) Report
- Executed Proposal
- Technical Proposal
- Change Order / Amendment

If the document does not fit a specific named type, use "Misc - Other".

Output JSON format: 
{ 
  "documentTypes": ["Primary Type"], 
  "title": "Concise Title", 
  "date": "YYYY-MM-DD or N/A", 
  "summary": "Short summary (max 2 sentences).", 
  "confidence": number 
}
`;

export const REQUEST_FORM_TEMPLATE = [
  { category: "Site Development", type: "Lease Agreements or Land Acquisition Agreements", explanation: "Contracts outlining the terms for leasing or purchasing the land for the project." },
  { category: "Site Development", type: "Full / Partial Deed of Reconveyance as applicable", explanation: "A document releasing a lien on the property once a loan or obligation is partially or fully paid." },
  { category: "Site Development", type: "Title Insurance", explanation: "Insurance protecting against financial loss from defects in the property title." },
  { category: "Site Development", type: "Zoning", explanation: "Documentation confirming the land’s zoning classification and permitted uses." },
  { category: "Site Development", type: "Conditional Use Permits", explanation: "Permits allowing land use that deviates from standard zoning, subject to specific conditions." },
  { category: "Site Development", type: "Informative Memo Identifying Required Permits", explanation: "A memo listing all permits needed for the project and their status." },
  { category: "Site Development", type: "ALTA Survey", explanation: "A detailed land survey showing boundaries, improvements, and encumbrances per ALTA standards." },
  { category: "Site Development", type: "Topo Survey", explanation: "A survey mapping the topography and elevation of the site." },
  { category: "Site Development", type: "Environmental Report(s)", explanation: "Reports assessing environmental impacts or risks (e.g., contamination) on the site." },
  { category: "Site Development", type: "Geotechnical Report(s)", explanation: "Studies evaluating soil and subsurface conditions to inform foundation design." },
  { category: "Site Development", type: "Flood Plain Delineation", explanation: "A map or report identifying areas subject to flooding risks." },
  { category: "Site Development", type: "Wetland Delineation", explanation: "A study identifying wetland boundaries and any regulatory restrictions." },
  { category: "Site Development", type: "Decommissioning Bond", explanation: "A financial guarantee ensuring funds for dismantling the project at the end of its life." },
  { category: "Site Development", type: "Power Quality Testing", explanation: "Tests verifying the site’s electrical supply meets required standards." },
  { category: "Site Development", type: "Site Development - Other", explanation: "Additional site-related documents as needed." },
  
  { category: "Construction", type: "Detailed Hard Cost Budget", explanation: "A breakdown of direct construction costs (e.g., labor, materials)." },
  { category: "Construction", type: "Development Budget & Soft Costs", explanation: "A budget covering indirect costs like design, permits, and administration." },
  { category: "Construction", type: "Construction CPM Schedule", explanation: "A critical path method schedule outlining project timelines and milestones." },
  { category: "Construction", type: "Schedule of Values / Milestone Payments", explanation: "A list assigning values to project phases for payment tracking." },
  { category: "Construction", type: "Notice to Proceed \"NTP\" (indicate if Limited or Full)", explanation: "Authorization to begin construction, either fully or with limitations." },
  { category: "Construction", type: "Performance Bond", explanation: "A bond ensuring the contractor completes the project per the contract." },
  { category: "Construction", type: "Payment Bond", explanation: "A bond guaranteeing payment to subcontractors and suppliers." },
  { category: "Construction", type: "Warranty Bond", explanation: "A bond covering defects or issues post-construction for a specified period." },
  { category: "Construction", type: "Construction Permits", explanation: "Permits required to legally perform construction activities." },
  { category: "Construction", type: "Construction - Other", explanation: "Additional construction-related documents as needed." },

  { category: "Engineering", type: "Conditional Use Permit \"CUP\" Drawing Set", explanation: "Drawings submitted with a CUP application showing project plans." },
  { category: "Engineering", type: "Structural / Mechanical Drawings & Specs", explanation: "Detailed plans and specifications for structural and mechanical systems." },
  { category: "Engineering", type: "Electrical Drawings & Specs", explanation: "Plans and specifications for electrical systems and wiring." },
  { category: "Engineering", type: "Civil Drawings & Specs", explanation: "Designs for site grading, drainage, and infrastructure." },
  { category: "Engineering", type: "Roof Systems", explanation: "Documentation on roof design and specifications." },
  { category: "Engineering", type: "Structural Load Bearing Capacity Analysis", explanation: "An analysis confirming the structure can support required loads." },
  { category: "Engineering", type: "Roof Condition, Age, Warranty", explanation: "A report on the roof’s current state, age, and warranty terms." },
  { category: "Engineering", type: "Engineering - Other", explanation: "Additional engineering-related documents as needed." },

  { category: "Equipment", type: "Solar PV Module: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on solar panel specifications, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "Solar PV Module: Bankability and/or Quality Report", explanation: "A report assessing the financial reliability and quality of the solar module supplier." },
  { category: "Equipment", type: "Inverter: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on inverter specifications, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "PV Inverter: Bankability and/or Quality Report", explanation: "A report evaluating the inverter supplier’s reliability and product quality." },
  { category: "Equipment", type: "Racking: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on racking system specifications, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "Racking: Bankability and/or Quality Report", explanation: "A report on the racking supplier’s financial stability and product quality." },
  { category: "Equipment", type: "Racking Manufacturer Documentation Regarding Design Life", explanation: "Manufacturer info on the expected lifespan of the racking system." },
  { category: "Equipment", type: "BESS: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on battery energy storage system specs, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "BESS: Bankability and/or Quality Report", explanation: "A report on the battery system supplier’s reliability and quality." },
  { category: "Equipment", type: "EMS: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on energy management system specs, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "EMS: Bankability and/or Quality Report", explanation: "A report assessing the EMS supplier’s financial stability and quality." },
  { category: "Equipment", type: "Solar Module: Bankability and/or Quality Report", explanation: "A report on the solar module supplier’s reliability and quality." },
  { category: "Equipment", type: "Transformer: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on transformer specs, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "BOS Components: Specs, Warranty, Certs, Technical Proposal, PO", explanation: "Details on balance of system components' specs, warranties, certifications, proposals, and purchase order." },
  { category: "Equipment", type: "Equipment - Other", explanation: "Additional equipment-related documents as needed." },

  { category: "Energy Simulation", type: "PVSyst or similar", explanation: "A simulation report estimating solar energy production." },
  { category: "Energy Simulation", type: "BESS use case simulation report", explanation: "A report modeling the battery storage system performance." },
  { category: "Energy Simulation", type: "Energy Simulation - Other", explanation: "Additional simulation-related documents as needed." },

  { category: "Insurance", type: "Architect/Engineer E&O Insurance Certificate", explanation: "Proof of errors and omissions insurance for design professionals." },
  { category: "Insurance", type: "Builder’s Risk / Erection All Risk \"EAR\"", explanation: "Insurance covering damage to the project during construction." },
  { category: "Insurance", type: "Contractor’s Certificate of Insurance", explanation: "Proof of the contractor’s liability and other insurance coverage." },
  { category: "Insurance", type: "Operation All Risk \"OAR\" Insurance / Business Interruption", explanation: "Insurance for operational risks and lost income post-construction." },
  { category: "Insurance", type: "Insurance - Other", explanation: "Additional insurance-related documents as needed." },

  { category: "Contracts", type: "Construction Contract (EPC)", explanation: "The main agreement with the engineering, procurement, and construction contractor." },
  { category: "Contracts", type: "EPC Subcontracts & Purchase Orders", explanation: "Sub-agreements and orders under the EPC contract." },
  { category: "Contracts", type: "Owner Procured Equip. Purchase Orders, Service Agreements", explanation: "Contracts for equipment or services directly purchased by the project owner." },
  { category: "Contracts", type: "Power Purchase Agreement (PPA)", explanation: "An agreement to sell the generated power to a buyer." },
  { category: "Contracts", type: "BESS Services Agreement (ESSA or similar)", explanation: "A contract for battery energy storage system services and maintenance." },
  { category: "Contracts", type: "BESS Manufacturer Long Term Service Agreement (LTSA)", explanation: "A long-term contract with the BESS manufacturer." },
  { category: "Contracts", type: "EMS Agreement", explanation: "A contract for the energy management system." },
  { category: "Contracts", type: "SREC and Other Incentive Contracts", explanation: "Agreements for solar renewable energy credits." },
  { category: "Contracts", type: "Interconnection Agreement", explanation: "A contract with the utility for connecting the project to the grid." },
  { category: "Contracts", type: "Interconnection Agreement - Associated escrow requirements", explanation: "Escrow terms tied to the interconnection agreement for financial assurances." },
  { category: "Contracts", type: "Interconnection Agreement - Associated utility studies", explanation: "Studies required by the utility to assess grid connection feasibility." },
  { category: "Contracts", type: "Operations & Maintenance Agreement", explanation: "A contract for ongoing operation and maintenance." },
  { category: "Contracts", type: "Asset Management Agreement", explanation: "An agreement for managing the project’s assets and performance." },
  { category: "Contracts", type: "Contracts - Other", explanation: "Additional contract-related documents as needed." },

  { category: "Financial", type: "EPC or Subcontracts & Purchase Orders", explanation: "Financial details of the EPC contract, subcontracts, and related purchase orders." },
  { category: "Financial", type: "Detailed Project Budget", explanation: "A comprehensive budget covering all project costs." },
  { category: "Financial", type: "Financial Model", explanation: "A projection of the project’s financial performance." },
  { category: "Financial", type: "Financial - Other", explanation: "Additional financial documents as needed." },

  { category: "Contractor Evaluation", type: "Company History", explanation: "Owner info, start year, niche, etc." },
  { category: "Contractor Evaluation", type: "List of Key Employees", explanation: "Names, positions, years of experience for key staff." },
  { category: "Contractor Evaluation", type: "Resumes of Key Employees", explanation: "Resumes for company officers and key staff." },
  { category: "Contractor Evaluation", type: "Organization Chart", explanation: "Formal organization chart." },
  { category: "Contractor Evaluation", type: "Audited Financial Statements", explanation: "Latest 3 years of financial statements." },
  { category: "Contractor Evaluation", type: "Current Work in Progress (WIP) Schedule", explanation: "Details on all current projects." },
  { category: "Contractor Evaluation", type: "Plans for Future Growth", explanation: "Strategic plans for growth." },
  { category: "Contractor Evaluation", type: "Scope of Work Details", explanation: "Details on self-performed vs subcontracted work." },
  { category: "Contractor Evaluation", type: "Major Equipment List", explanation: "List of major equipment owned." },
  { category: "Contractor Evaluation", type: "Estimating Process", explanation: "Description of process for estimation." },
  { category: "Contractor Evaluation", type: "Cost Monitoring Process", explanation: "Process to monitor project costs." },
  { category: "Contractor Evaluation", type: "Safety Program and EMR", explanation: "Safety program and EMR rating." },
  { category: "Contractor Evaluation", type: "Contractor's License", explanation: "Copy of licenses." },
  { category: "Contractor Evaluation", type: "Similar Project History", explanation: "List of similar projects in last 3-5 years." },
  { category: "Contractor Evaluation", type: "Project References", explanation: "3-5 client references." },
  { category: "Contractor Evaluation", type: "Proof of Insurance", explanation: "Current COIs." },
  { category: "Contractor Evaluation", type: "Bonding Capacity Letter", explanation: "Letter from surety company." },
  { category: "Contractor Evaluation", type: "Litigation and Disputes History", explanation: "Summary of pending or past litigation." },
  { category: "Contractor Evaluation", type: "Quality Management System (QMS) Manual", explanation: "Formal QMS documentation." },
  { category: "Contractor Evaluation", type: "Subcontractor Prequalification Process", explanation: "Process to vet subcontractors." },
  { category: "Contractor Evaluation", type: "Contractor Evaluation - Other", explanation: "Additional contractor evaluation documents." },

  { category: "Misc. Documents", type: "Project Overview", explanation: "Summary document." },
  { category: "Misc. Documents", type: "Previous IE Report", explanation: "Prior independent engineer’s report." },
  { category: "Misc. Documents", type: "Feasibility Study", explanation: "Technical and economic viability analysis." },
  { category: "Misc. Documents", type: "Misc. Documents - Other", explanation: "Additional miscellaneous documents as needed." },
];
