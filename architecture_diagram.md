# Splunk Co>Dev — System Architecture Diagram 📊

This file contains the system architecture diagram for **Splunk Co>Dev**, illustrating the closed-loop flow between the React Frontend, Node.js/Express API Backend, Splunk Enterprise, and the Groq AI Cloud.

---

## 🎨 System Architecture (Mermaid)

```mermaid
graph TD
    %% Frontend Layer
    subgraph Frontend [React SPA]
        UI[App UI & Router]
        CM[Copilot Mode<br>SSE Streaming]
        QM[Query Mode<br>Cost Shield UI]
        OM[Onboard Mode]
    end

    %% Backend Layer
    subgraph Backend [Node.js Express API]
        CR[copilot.js<br>In-Memory Cache]
        QR[query.js<br>SPL Debugging]
        SR[splunk.js<br>Job Poller]
        WR[workspace.js<br>Context Indexer]
        
        QV[[queryValidator.js<br>Cost Shield]]
        HEC[[splunkHEC.js<br>Telemetry]]
    end

    %% External Systems
    subgraph External [Splunk Enterprise]
        REST[REST API<br>Port 8089]
        HECEP[HEC Endpoint<br>Port 8088]
    end
    
    subgraph AI [Groq Cloud]
        LLM[Llama 3 Models<br>8B Instant / 70B Versatile]
    end

    %% Connections
    UI --> |Chat/Suggest| CR
    UI --> |Debug SPL| QR
    UI --> |Live Execute| SR
    UI --> |Connect Repo| WR

    CR --> |Stream Tokens| LLM
    QR --> QV
    QV --> |Valid| LLM
    QV -.-> |CRITICAL| UI
    
    SR --> |Poll Job Status| REST
    QR --> |Log Action| HEC
    OM --> |Log Action| HEC
    WR --> |Log Action| HEC
    
    HEC --> |Fire & Forget| HECEP
```

---

## 🧱 Component Breakdown

1. **Frontend (React)**:
   * Provides the interactive interface. Features dedicated panels for Copilot chat streams, query validations, log onboarding, agent asset building, and DBA scan analytics.
2. **Backend (Express)**:
   * Hosts REST API routes to process requests. Handles static rule-based pre-validation for the Cost Shield and logs telemetric events asynchronously.
3. **External Splunk Enterprise**:
   * Runs local/cloud searches via REST Port `8089` and ingests developer metrics via HTTP Event Collector (HEC) on Port `8088`.
4. **AI Cloud (Groq)**:
   * Hosts high-speed Llama models that power SPL conversions, error debugging, and conversational assistance.
5. **Local Workspace**:
   * Writes compliant log field mappings dynamically to local `props.conf` files.
