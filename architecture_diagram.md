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
        QM[Query & SPL2 Mode]
        OM[Onboard Mode]
        AM[Bulk Agent Mode]
        OP[Optimizer Mode]
        CIMM[CIM Mapper Mode]
    end

    %% Backend Layer
    subgraph Backend [Node.js Express API]
        CR[copilot.js<br>In-Memory Cache]
        QR[query.js<br>SPL Debugging]
        MR[migrate.js<br>SPL2 Conversion]
        CIMR[cim.js<br>CIM Mapping & Local Write]
        AR[agent.js<br>Bulk Deployment]
        OR[optimizer.js<br>Saved Search Tuner]
        SR[splunk.js<br>Job Poller & Executor]
        WR[workspace.js<br>Context Indexer]
        
        QV[[queryValidator.js<br>Cost Shield]]
        HEC[[splunkHEC.js<br>HEC Telemetry]]
    end

    %% External Systems
    subgraph External [Splunk Enterprise]
        REST[REST API<br>Port 8089]
        HECEP[HEC Endpoint<br>Port 8088]
    end
    
    subgraph Files [Local Codebase]
        CONF[props.conf<br>local/props.conf]
    end

    subgraph AI [Groq Cloud]
        LLM[Llama 3 Models<br>8B Instant / 70B Versatile]
    end

    %% Connections
    UI --> |Tab Navigation| CM
    UI --> |Tab Navigation| QM
    UI --> |Tab Navigation| OM
    UI --> |Tab Navigation| AM
    UI --> |Tab Navigation| OP
    UI --> |Tab Navigation| CIMM

    CM --> |Chat/Suggest| CR
    QM --> |Debug SPL| QR
    QM --> |Migrate SPL2| MR
    OM --> |Onboard Log| QR
    CIMM --> |CIM Mapping| CIMR
    AM --> |Bulk Deploy| AR
    OP --> |Scan/Swap Searches| OR
    QM --> |Live Run| SR

    CR --> |Stream Suggestions| LLM
    QR --> QV
    QV --> |Valid| LLM
    QV -.-> |CRITICAL Block| UI
    MR --> |Translate SPL| LLM
    CIMR --> |Map CIM Fields| LLM
    CIMR --> |Write Configs| CONF
    AR --> |Parse SPL Inputs| LLM
    OR --> |Audit SPL Batch| LLM

    SR --> |Run Search Job| REST
    AR --> |Deploy Assets| REST
    OR --> |Hot-Swap Searches| REST
    
    %% Telemetry Connections
    QR --> |Log Action| HEC
    CIMR --> |Log Action| HEC
    AR --> |Log Action| HEC
    OR --> |Log Action| HEC
    HEC --> |Fire & Forget HEC Logs| HECEP
```

---

## 🧱 Component Breakdown

1. **Frontend (React)**:
   * **Copilot Mode**: Real-time SSE streaming for interactive code/query assistance.
   * **Query & SPL2 Mode**: Raw SPL input debugger, live executor, and SPL1-to-SPL2 translation workspace.
   * **Onboard Mode**: Structured interface for onboarding new log data.
   * **Bulk Agent Mode**: Natural language interface to define, preview, and build dashboards, alerts, and reports.
   * **Optimizer Mode**: Audits existing saved searches, displaying inefficient patterns and offering 1-click hot-swaps.
   * **CIM Mapper Mode**: Raw log mapping to CIM schema with configuration output.

2. **Backend (Express)**:
   * **queryValidator.js**: Deterministic query parsing preventing wildcard searches and costly operations.
   * **cim.js**: Maps JSON/raw log structures to Splunk CIM standard properties and appends resulting `FIELDALIAS` configurations to the local workspace.
   * **agent.js**: Orchestrates natural language parsing into Simple XML Dashboards, Reports, and Alerts via REST APIs.
   * **optimizer.js**: Scans Splunk saved searches, identifies sub-optimal joins, transactions, or stats patterns, and queries the LLM to rewrite them into high-performance alternatives.
   * **splunkHEC.js**: Telemetry framework logging developer interactions to Splunk Enterprise via the HTTP Event Collector.

3. **External Splunk Enterprise**:
   * Runs local/cloud searches via REST Port `8089` and ingests developer metrics via HTTP Event Collector (HEC) on Port `8088`.

4. **AI Cloud (Groq)**:
   * Hosts high-speed Llama models that power SPL conversions, error debugging, and conversational assistance.

5. **Local Workspace**:
   * Writes compliant log field mappings dynamically to local `props.conf` files.

