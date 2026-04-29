/**
 * VEDA AI LAB — Complete Company Knowledge Base
 *
 * Merged and deduplicated from:
 *   - Partnership Brochure 2026 (PDF)
 *   - Context 1 (Exhaustive Technical Overview)
 *   - Context 2 (Comprehensive Brochure Breakdown)
 *
 * This is injected as system context into every AI generation call.
 * Keep it clean, structured, and token-efficient.
 */

export const VEDA_CONTEXT = `
=== SECTION 1: COMPANY IDENTITY ===
Company Name: Veda AI Lab LLC
Legal Status: Registered LLC in Kentucky, USA
Tagline: "Your Invisible AI R&D Partner"
Services Tagline: "White-Label AI Agents · Chatbots · Automation · LLM Hosting · ERP Intelligence"
Mission: To function as an agency's invisible in-house AI division — delivering enterprise-grade AI solutions that agencies can sell as their own.

Key Metrics:
- 50+ Agency Partners across the US & Europe
- 200+ Solutions Deployed
- 99.9% Uptime SLA
- <48 Hours Partner Onboarding
- 15+ Years of software industry experience
- 3 Countries Served

=== SECTION 2: COMPANY HISTORY ===
2011: Founded — started building enterprise-grade software solutions.
2013: Operated as Qwesys Digital Solutions — ERP development and customization for ERPNext, Zoho, SAP, and Oracle.
2022: AI/ML Transformation — pivoted to intelligent automation in response to agency demand.
Current: Established as Veda AI Lab LLC (Kentucky, USA) — serving agencies globally with full white-label AI services.

Origin quote: "Born from 15+ years of enterprise software experience. We don't just build AI — we disappear, so your agency shines."

=== SECTION 3: WHITE-LABEL PARTNERSHIP MODEL ("Built for Agency Success") ===
100% Invisible:
- We sign strict NDAs and can work under your email domain. Your clients never know we exist.

Fixed & Retainer Pricing:
- Predictable costs so agencies maintain healthy margins. No surprises, no scope creep.

Rapid Delivery:
- Prototypes in 5-7 days. Full solutions in 2-4 weeks. We move at agency speed.

Dedicated Slack Channel:
- Real-time collaboration via Slack Connect with your project lead — not a support queue.

Transparent Reporting:
- Weekly sprint updates, shared project board, and milestone demos. Full visibility without micromanaging.

Full IP Transfer:
- You or your client owns everything — source code, docs, and deployment guides — upon full payment.

Branded Deliverables:
- All proposals, architecture diagrams, user guides, and dashboards carry the agency's branding. Zero trace of Veda AI Lab.

Client Management:
- The agency runs the meetings. Veda prepares talking points, objection handlers, and live demos behind the scenes.

=== SECTION 4: SERVICES ===

--- 4A: CUSTOM AI AGENTS (Starting from $3,000) ---
Overview: Autonomous agents designed to execute specific workflows — from lead qualification and support triage to data analysis and custom ERP/CRM integrations.

Sub-Capabilities:
- Lead Qualification & Sales: Score, qualify, and route inbound leads via CRM integration. Automates the entire lead lifecycle. Result: 5x lead velocity improvement.
- Support Triage & Resolution: AI categorizes and auto-responds using CRM data and knowledge bases. Learns from historical tickets. Result: 60% faster ticket resolution.
- Data Analysis & Reporting: Agents analyze datasets from ERPs — producing dashboards, anomaly alerts, and executive summaries via natural language querying. Result: Auto-generated executive insights.
- Custom Tool Integrations: Connect to any API, database, or platform. Fault-tolerant connectors with advanced retry logic. Result: 100+ API connectors available.
- Appointment & Scheduling: AI-powered agents that coordinate calendars, send reminders, sync across platforms. Timezone-aware with smart conflict detection. Result: 24/7 autonomous booking.
- Compliance & Monitoring: Automated compliance checks, audit trail generation, real-time monitoring agents that flag policy violations. Result: Real-time violation alerts.

Deliverables: Deployed Agent(s), API Documentation, White-Label Dashboard, 90-Day Support
Tech Stack: LangChain, OpenAI, CrewAI, Python, n8n, Pinecone
Common Use Cases: Lead scoring & routing, customer support automation, data pipelines, invoice processing, compliance monitoring, appointment scheduling

--- 4B: AI VOICE & VIDEO AGENTS (Starting from $6,000) ---
Overview: Beyond text — AI agents that talk, listen, and see. Deploy 24/7 phone agents and video meeting assistants that feel human and adapt to the client's brand tone.

Sub-Capabilities:
- AI Voice Call Agents: Inbound/outbound 24/7 phone agents for inquiries, appointment booking, and lead qualification. Available in 20+ languages with natural conversation flow.
- AI Video Meeting Assistants: Join calls, transcribe in real-time, generate summaries, and auto-update CRMs. Integrates with Zoom, Google Meet, and Microsoft Teams.
- Real-Time Sentiment Analysis: Live speech-to-text with sentiment detection. Monitor satisfaction scores, flag escalations instantly, and provide agent coaching prompts.
- Natural-Sounding AI Voices: Custom voice cloning and brand-tone adaptation. Indistinguishable from humans with dynamic emotional tone variation.
- Outbound Campaign Calls: AI-powered outbound dialing for collections, surveys, and follow-ups. Scale to thousands of simultaneous calls with adaptive scripting. Result: 1000s of calls/day at scale.
- Call Recording & Analytics: Automatic transcription, keyword extraction, compliance logging, and performance dashboards.

Deliverables: Voice Agent Deployment, Call Analytics Dashboard, CRM Integration, 90-Day Support
Tech Stack: Vapi, LiveKit, ElevenLabs, Deepgram, OpenAI Realtime, Twilio
Common Use Cases: 24/7 inbound support, appointment booking, payment reminders, meeting transcription, outbound campaigns, multi-language calls

--- 4C: INTELLIGENT CHATBOTS (Starting from $2,500) ---
Overview: RAG-powered chatbots that understand context, documents, and company knowledge. Connect to SharePoint, Salesforce, Confluence, and speak 50+ languages.

Sub-Capabilities:
- Document Q&A Systems: Upload PDFs or connect to corporate wikis — chatbot answers with source citations and page references. Perfect for enterprise knowledge management.
- Multi-Language Support: Serve global audiences in 50+ languages with automatic detection and culturally appropriate responses.
- Custom Knowledge Bases: Build structured knowledge from scattered data — catalogs, SOPs, legal docs — all searchable via natural language queries.
- CRM Sync & Analytics: Track queries, identify knowledge gaps, measure resolution rates, and auto-log conversations to CRM.
- E-Commerce Product Advisor: Intelligent product recommendations based on customer preferences, browsing history, and real-time inventory. Result: 35% conversion rate boost.
- White-Label Web Widget: Fully customizable chat widget in the client's brand colors and tone. Embeds in any website with a single script tag instantly.

Deliverables: Chatbot + Web Widget, Admin Panel, Analytics Dashboard, White-Label Embed
Tech Stack: RAG, LangChain, Pinecone, OpenAI, Supabase, Next.js
Connects to: SharePoint, Salesforce, Confluence
Common Use Cases: Customer FAQ bots, knowledge assistants, HR policy chatbots, product recommendations, legal document Q&A, IT helpdesk

--- 4D: WORKFLOW AUTOMATION (Starting from $4,000) ---
Overview: Automate repetitive tasks across CRM, ERP, and Email using n8n, Make, or custom Python. Connect SAP, Oracle, Dynamics, ERPNext, Zoho, Salesforce, and dozens more.

Sub-Capabilities:
- CRM-ERP Synchronization: Bi-directional sync between CRMs (Salesforce, HubSpot) and ERPs (SAP, Oracle). Real-time data consistency with conflict resolution and audit trails.
- Email & Communication: Trigger-based sequences, intelligent routing, and auto-responses across Gmail, Outlook, Slack. Smart follow-up detection ensures nothing falls through. Result: Zero missed follow-ups.
- Invoice & Document Processing: AI-powered extraction from invoices and contracts — auto-validate, match POs, and push to accounting systems. Result: 99% extraction accuracy.
- Custom Integration Pipelines: Connect any tools via REST APIs, webhooks, databases. Robust plumbing with retry logic and dead-letter queues. Result: Fault-tolerant architecture.
- Employee Onboarding Flows: Automated HR workflows from offer letter to IT provisioning. Slack invites and training schedules triggered on hire with configurable approvals. Result: Day-one ready automation.
- Marketing Automation: Campaign triggers, lead nurture sequences, UTM tracking, and multi-channel orchestration across email, SMS, and ad platforms.

Deliverables: Configured Workflows, Error Handling & Retry, Monitoring Dashboard, 30-Day Tuning
Tech Stack: n8n, Make, Python, REST APIs, Webhooks, Zapier
Common Use Cases: Order-to-invoice pipelines, employee onboarding, report generation, data syncing, campaign triggers, inventory alerts

--- 4E: SELF-HOSTED LLMs / ENTERPRISE PRIVACY (Starting from $15,000) ---
Overview: Deploy Llama 4, Mistral on private infrastructure for clients with strict data privacy, HIPAA, or regulatory requirements. No data leaves their environment — ever.

Sub-Capabilities:
- Llama 4 & Mistral Deployment: Production-ready on AWS, Azure, or bare metal. Optimized inference with auto-scaling, load balancing, and GPU cluster management.
- Model Fine-Tuning: Fine-tune on proprietary data (legal contracts, financial data). Domain-specific accuracy improvements of 30-50% with LoRA and QLoRA.
- HIPAA & SOC 2 Compliant: Encrypted at rest/transit, audit logging, role-based access, and VPC isolation. Full compliance documentation for regulated industries.
- Cost-Optimized Inference: Quantization, batching, and response caching cutting GPU costs by 40-70% while maintaining output quality. Smart token-level cost tracking.
- RAG Pipeline Integration: Connect self-hosted LLMs to internal knowledge bases via Retrieval-Augmented Generation pipelines with hybrid search. Result: Private knowledge retrieval.
- Air-Gapped Deployment: Fully offline deployment for defense and high-security environments. No internet connection required — complete data sovereignty. Result: Zero external dependencies.

Deliverables: Deployed LLM, Fine-Tuned Model, API Gateway, IaC (Terraform/Helm), Compliance Docs
Tech Stack: Llama 4, Mistral, vLLM, Terraform, Kubernetes, Docker
Common Use Cases: Legal contract analysis, financial data processing, healthcare records, proprietary chatbots, government AI, air-gapped environments

--- 4F: ERP INTELLIGENCE / BUSINESS INTELLIGENCE (Starting from $20,000) ---
Overview: AI-powered inventory forecasting, sales prediction, and automated procurement for SAP, Oracle, Microsoft Dynamics, ERPNext & Zoho. Turn raw data into decisions.

Sub-Capabilities:
- Inventory Forecasting: ML models trained on historical sales and seasonality — reducing overstock costs by 20-35% and eliminating stockouts with predictive reordering.
- Sales Prediction: Predict revenue, score deal probability, and identify at-risk accounts using ERP data. Result: 25%+ forecast accuracy improvement.
- Automated Procurement: AI-triggered purchase orders based on consumption patterns and budget constraints. Result: 15-25% procurement cost savings.
- Anomaly Detection: Real-time dashboards flagging unusual spending, inventory discrepancies, and fraud patterns automatically. Result: Instant anomaly alerts.
- Cash Flow Prediction: Predict cash positions 30/60/90 days out using AR/AP data, seasonal patterns, and customer payment behavior. Scenario modeling included.
- Supplier Scoring: AI-ranked supplier performance using delivery times and pricing history. Automated vendor recommendation engine with risk assessment scoring.

Deliverables: Trained ML Models, Custom Dashboards, ERP Connectors, Alert System, Retraining Pipeline
Tech Stack: Python, scikit-learn, TensorFlow, ERPNext API, SAP RFC, Power BI
Common Use Cases: Demand forecasting, price optimization, supplier scoring, cash flow prediction, churn analysis, warehouse optimization

--- 4G: WHITE-LABEL R&D (Custom Pricing — Let's Talk) ---
Overview: Your agency needs an AI division? We are it. From capability decks to client demos, we function as your in-house AI team — fully white-labeled. Your clients will never know.

Sub-Capabilities:
- Branded Documentation: Every document — proposals, architecture diagrams, user guides — carries your branding. Zero trace of Veda AI Lab anywhere in deliverables.
- Client-Facing Demos: Working prototypes that impress clients. We prepare talking points, objection handlers, and live demos for the agency to run.
- Ongoing Maintenance: Post-launch support under the agency's brand — bug fixes, feature additions, and security patches with complete invisibility.
- Capability Presentations: Custom decks, ROI calculators, and technical feasibility documents. We make agencies look like AI experts.
- Dedicated Team Assignment: Named engineers assigned to the account who learn the client's stack and communication style. Consistent quality across projects.
- Slack & Email Integration: Our team operates under the agency's email domain and Slack workspace. Complete operational invisibility.

Deliverables: Full Project Under Your Brand, Source Code & IP Transfer, Branded Docs, Client-Ready Demos
What We Handle: Technical proposals, architecture diagrams, SOWs & contracts, client presentations, ROI calculators, post-launch maintenance

=== SECTION 5: TECHNICAL ECOSYSTEM ===
We integrate with the client's existing stack across all domains:

AI & ML: OpenAI, Anthropic, LangChain, Meta/Llama, Pinecone, vLLM, Whisper
Enterprise ERP: SAP, Oracle, Microsoft Dynamics 365, ERPNext, Zoho
CRM & Sales: Salesforce, HubSpot, Pipedrive
Communication: Slack, MS Teams, Twilio, Notion
Voice & Video AI: Vapi, LiveKit, ElevenLabs, Deepgram, OpenAI Realtime, WebRTC
E-Commerce & Accounting: Shopify, Magento, QuickBooks, Xero
Automation & Cloud: n8n, Make, Zapier, AWS, GCP, Azure
Dev Stack: Python, Next.js, React, Node.js, Supabase, PostgreSQL, Docker, Kubernetes, Terraform
Additional Capabilities: RAG, Fine-Tuning (LoRA/QLoRA), vLLM inference optimization

=== SECTION 6: TEAM ===
25 People. One Mission.
No freelancers. No subcontracting. A dedicated, senior team that picks up the phone, remembers the client's stack, and treats agency deadlines as their own.

Team Composition:
- AI/ML Engineers: 6
- Full-Stack Developers: 4
- ERP Architects: 3
- Prompt Engineers: 2
- QA & DevOps: 3
- Support Staff: 4
- Business Team: 3

Culture Quote: "When you partner with Veda, you get direct access to the engineers building your solutions. No project managers gatekeeping — just senior developers who understand your client's business."

=== SECTION 7: HOW WE WORK (Process) ===
Simple. Transparent. Designed for Agencies.
NDA is signed before any scope discussion begins. Client relationships stay yours — always.

Step 1 — Discovery & Scope (Free · No Commitment):
Analyze client requirements and define technical architecture. Deliver a white-label proposal the agency can present as their own.

Step 2 — Development (2-4 Week Sprints):
Build in agile sprints with regular updates via white-label Slack channel or project board. Full transparency at every stage.

Step 3 — Integration & Testing (Rigorous QA):
Connect the AI solution to the client's ERP, CRM, or existing stack. Perform rigorous QA testing before any deployment.

Step 4 — Handover & Support (Full Documentation):
Deploy, document everything under the agency's brand, and hand over. Ongoing maintenance and support packages available.

=== SECTION 8: SECURITY, COMPLIANCE & TRUST ===
NDA-First: Every engagement starts with a signed NDA. No exceptions. We sign before any scope discussion begins.
SOC 2 Type II: Development, deployment, and data handling follow SOC 2 Type II security practices rigorously.
ISO 27001 Aligned: Information security management aligned with ISO 27001 standards across all operations.
Full IP Transfer: Source code, documentation, deployment guides — everything transfers to the agency/client upon full payment.
US Legal Entity: Veda AI Lab LLC registered in Kentucky, USA. US contract law protections.
Zero Client Exposure: We never reference clients, their brands, or their data. Only anonymized case studies — always.
Uptime: 99.9% SLA.

=== SECTION 9: SUCCESS STORIES (Anonymized) ===
These are real results from real engagements — anonymized because confidentiality is our brand promise.

Manufacturing Agency — 40% Cost Reduction:
Custom AI Agents for lead qualification and CRM automation integrated with SAP. Replaced 3 manual processes entirely.

HealthTech Consultancy — 3x Faster Patient Onboarding:
HIPAA-compliant RAG chatbots with document understanding. Patients onboarded 3x faster with zero compliance issues.

E-Commerce Agency — 120 Hours/Month Saved:
ERPNext integration with AI-powered inventory forecasting. Team reclaimed 120 hours per month from manual inventory checks.

Legal Tech Firm — 65% Faster Contract Reviews:
Custom AI agents analyzing confidential contracts using self-hosted LLMs. Contract review time cut by 65%.

Real Estate Agency — 2x Qualified Leads:
AI voice agents pre-qualifying buyer inquiries 24/7 via phone. Doubled qualified lead conversion rate.

Retail Chain — 30% Less Overstock:
AI-powered demand forecasting across 50+ locations using Oracle ERP data. Reduced overstock costs by 30%.

=== SECTION 10: INDUSTRIES SERVED ===
15+ years. Every vertical. One constant: enterprise-grade quality.

- FinTech & Banking
- Legal & Compliance
- Real Estate
- E-Commerce & Retail
- Manufacturing
- Education & EdTech
- Logistics & Supply Chain
- SaaS & Technology
- Recruitment & HR
- Government
- Media & Marketing
- Hospitality & Travel

Note: "We've served virtually every industry — and we're actively building out our healthcare capability too."

=== SECTION 11: PRICING ===

YOUR FIRST PROJECT — ON YOUR TERMS:
We believe in earning trust through delivery, not promises.
- Flexible Payment: Pay in milestones. No large upfront commitment.
- Your Timeline: You set the deadline. We build around your schedule.
- Free Scoping: Requirements analysis and white-label proposal at no cost.
- 90-Day Support: Extended post-launch support included (vs. 30-day standard elsewhere).

Per-Project Pricing:
- Custom AI Agents: from $3,000
- AI Voice/Video Agents: from $6,000
- Intelligent Chatbots: from $2,500
- Workflow Automation: from $4,000
- Self-Hosted LLMs: from $15,000
- ERP Intelligence: from $20,000

Monthly Retainer Plans (for ongoing agency capacity):

Starter — $2,500/month (For agencies testing AI waters):
- 40 development hours
- 1 active project
- Slack support
- Weekly status updates
- White-label delivery

Growth — $5,000/month — MOST POPULAR (For scaling agencies):
- 100 development hours
- 3 active projects
- Priority Slack channel
- Weekly strategy calls
- Dedicated Project Manager
- White-label everything

Enterprise — $8,000/month (For agencies going all-in):
- 200+ development hours
- Unlimited projects
- Dedicated team
- 24/7 priority support
- Custom SLA
- Executive reviews

=== SECTION 12: CONTACT ===
Email: partners@vedaailab.com
Website: vedaailab.com
Partnership Application: vedaailab.com/partnership
Response Time: Less than 24 hours — no gatekeepers
Headquarters: Kentucky, USA (LLC)
Call to Action: "Stop Turning Away AI Projects. Start delivering cutting-edge AI solutions to your clients tomorrow. No hiring. No training. No risk."
`.trim();

// Legacy export alias kept for any direct references during migration
export const BROCHURE_CONTEXT = VEDA_CONTEXT;