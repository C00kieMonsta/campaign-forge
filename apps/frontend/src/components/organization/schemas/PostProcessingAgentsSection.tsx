import { useState } from "react";
import {
  TASK_CRITICALITY,
  type AgentDefinition,
  type TaskCriticality
} from "@packages/types";
import { Button, Card, Switch } from "@packages/ui";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Zap
} from "lucide-react";

interface PostProcessingAgentsSectionProps {
  agents: AgentDefinition[];
  onChange: (agents: AgentDefinition[]) => void;
  schemaProperties?: string[]; // Property names from schema for reference suggestions
}

const BOT_AVATARS = [
  { color: "bg-primary", icon: "🤖" },
  { color: "bg-muted-foreground/20", icon: "🦾" },
  { color: "bg-primary", icon: "✨" },
  { color: "bg-muted-foreground/20", icon: "🎯" },
  { color: "bg-primary", icon: "🧠" },
  { color: "bg-muted-foreground/20", icon: "⚡" },
  { color: "bg-primary", icon: "🔮" },
  { color: "bg-muted-foreground/20", icon: "🚀" },
  { color: "bg-primary", icon: "💎" },
  { color: "bg-muted-foreground/20", icon: "🌟" }
];

const AGENT_TEMPLATES = [
  {
    name: "Remove Duplicates",
    prompt:
      "Remove duplicate entries based on item name and code. Keep the first occurrence and discard subsequent duplicates.",
    icon: "🧹"
  },
  {
    name: "Filter by Quantity",
    prompt:
      "Remove items with quantity less than 1 or marked as zero. Only keep items with valid positive quantities.",
    icon: "🔍"
  },
  {
    name: "Validate Required Fields",
    prompt:
      "Flag or remove items missing required technical specifications or measurements. Ensure data quality.",
    icon: "✅"
  },
  {
    name: "Group by Material",
    prompt:
      "Group items by material type and sort within each group by quantity. Organize results for better readability.",
    icon: "📁"
  },
  {
    name: "Calculate Totals",
    prompt:
      "Add calculated fields like total cost (quantity × unit price) or total area. Enrich data with computed values.",
    icon: "✨"
  }
];

export function PostProcessingAgentsSection({
  agents,
  onChange,
  schemaProperties = []
}: PostProcessingAgentsSectionProps) {
  const [showTemplates, setShowTemplates] = useState(agents.length === 0);
  const [editingAgentIndex, setEditingAgentIndex] = useState<number | null>(
    null
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState<number | null>(null);

  const addAgentFromTemplate = (template: { name: string; prompt: string }) => {
    const newAgent: AgentDefinition = {
      name: template.name,
      prompt: template.prompt,
      order: agents.length + 1,
      enabled: true,
      description: "",
      criticality: TASK_CRITICALITY.LOW
    };
    onChange([...agents, newAgent]);
    setEditingAgentIndex(agents.length);
    setShowTemplates(false);
  };

  const addBlankAgent = () => {
    const newAgent: AgentDefinition = {
      name: `Agent ${agents.length + 1}`,
      prompt: "",
      order: agents.length + 1,
      enabled: true,
      description: "",
      criticality: TASK_CRITICALITY.LOW
    };
    onChange([...agents, newAgent]);
    setEditingAgentIndex(agents.length);
    setShowTemplates(false);
  };

  const updateAgent = (index: number, updates: Partial<AgentDefinition>) => {
    const updatedAgents = agents.map((agent, i) =>
      i === index ? { ...agent, ...updates } : agent
    );
    onChange(updatedAgents);
  };

  const deleteAgent = (index: number) => {
    const updatedAgents = agents.filter((_, i) => i !== index);
    // Update order values
    const reorderedAgents = updatedAgents.map((agent, i) => ({
      ...agent,
      order: i + 1
    }));
    onChange(reorderedAgents);
    if (editingAgentIndex === index) {
      setEditingAgentIndex(null);
    }
    // Show templates if no agents left
    if (reorderedAgents.length === 0) {
      setShowTemplates(true);
    }
  };

  const handlePromptChange = (index: number, value: string) => {
    updateAgent(index, { prompt: value });

    // Show suggestions if "/" is typed at the end and we have schema properties
    setShowSuggestions(value.endsWith("/") && schemaProperties.length > 0);
    setSuggestionIndex(index);
  };

  const insertProperty = (index: number, propName: string) => {
    const agent = agents[index];
    // Remove the trailing "/" and add the property
    const promptWithoutSlash = agent.prompt.endsWith("/")
      ? agent.prompt.slice(0, -1)
      : agent.prompt;
    const newPrompt = `${promptWithoutSlash}/${propName}`;

    updateAgent(index, { prompt: newPrompt });
    setShowSuggestions(false);
    setSuggestionIndex(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3 py-6">
        <div className="flex items-center justify-center gap-2 text-4xl mb-2">
          <span className="animate-bounce">🤖</span>
          <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>
            ✨
          </span>
        </div>
        <h2 className="text-2xl font-bold text-foreground">
          Post-Processing Agents
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto text-balance">
          Agents are helpful bots that automatically clean, organize, and
          validate your extracted data. Add them one at a time to build your
          perfect workflow.
        </p>
      </div>

      {/* Templates */}
      {showTemplates && agents.length < 10 && (
        <Card className="p-6 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                Choose Your First Agent
              </h3>
              <p className="text-sm text-muted-foreground">
                Pick a template to get started quickly, or create your own from
                scratch
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {AGENT_TEMPLATES.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => addAgentFromTemplate(template)}
                  className="p-5 text-left rounded-xl border-2 border-border bg-card hover:bg-muted/50 hover:border-primary hover:shadow-lg transition-all group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-2xl flex-shrink-0 group-hover:scale-110 transition-transform shadow-md">
                      {template.icon}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-base font-semibold text-foreground">
                          {template.name}
                        </h5>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {template.prompt}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-2">
              <Button
                type="button"
                onClick={addBlankAgent}
                variant="outline"
                className="w-full gap-2 h-14 border-dashed hover:bg-muted/50 bg-transparent"
              >
                <Plus className="h-5 w-5" />
                <span className="font-medium">Start from Scratch</span>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Agent List */}
      {agents.length > 0 && (
        <div className="space-y-3">
          {agents.map((agent, index) => {
            const avatar = BOT_AVATARS[index % BOT_AVATARS.length];
            const isEditing = editingAgentIndex === index;

            return (
              <Card
                key={index}
                className={`overflow-hidden transition-all ${
                  !agent.enabled ? "opacity-60" : ""
                } ${isEditing ? "ring-2 ring-primary shadow-lg" : ""}`}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setEditingAgentIndex(isEditing ? null : index)}
                >
                  <div className="flex items-center gap-4">
                    <GripVertical className="h-5 w-5 text-muted-foreground cursor-move flex-shrink-0" />

                    <div
                      className={`w-12 h-12 rounded-xl ${avatar.color} flex items-center justify-center text-2xl flex-shrink-0 shadow-md`}
                    >
                      {avatar.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          Agent {index + 1}
                        </span>
                        {agent.enabled && (
                          <span className="flex items-center gap-1 text-xs text-primary">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            Active
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-foreground">
                        {agent.name || "Unnamed Agent"}
                      </h3>
                      {!isEditing && agent.prompt && (
                        <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                          {agent.prompt}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Switch
                        checked={agent.enabled}
                        onCheckedChange={(checked) =>
                          updateAgent(index, { enabled: checked })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAgent(index);
                        }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      {isEditing ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="px-4 pb-4 space-y-4 border-t border-border bg-muted/20">
                    <div className="pt-4">
                      <label
                        htmlFor={`agent-name-${index}`}
                        className="text-xs font-medium block mb-1.5"
                      >
                        Agent Name
                      </label>
                      <input
                        id={`agent-name-${index}`}
                        type="text"
                        value={agent.name}
                        onChange={(e) =>
                          updateAgent(index, { name: e.target.value })
                        }
                        placeholder="e.g., Duplicate Remover, Price Validator..."
                        className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                        maxLength={100}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {agent.name.length}/100 characters
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor={`agent-prompt-${index}`}
                        className="text-xs font-medium block mb-1.5"
                      >
                        What should this agent do?
                      </label>
                      <textarea
                        id={`agent-prompt-${index}`}
                        value={agent.prompt}
                        onChange={(e) => handlePromptChange(index, e.target.value)}
                        placeholder={
                          schemaProperties.length > 0
                            ? "Type instruction. Use /propertyName to reference schema fields..."
                            : "Describe the task in plain language. For example: 'Remove all items where quantity is 0' or 'Group items by material type and sort by price'"
                        }
                        className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm min-h-[120px] resize-none"
                        maxLength={5000}
                      />

                      {/* Property Suggestions Dropdown */}
                      {showSuggestions &&
                        suggestionIndex === index &&
                        schemaProperties.length > 0 && (
                          <div className="mt-2 bg-muted border border-border rounded-md p-3 space-y-2 animate-in fade-in slide-in-from-top-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              📌 Available schema properties:
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {schemaProperties.map((prop) => {
                                const isAlreadyReferenced =
                                  agent.prompt.includes(`/${prop}`);
                                return (
                                  <button
                                    key={prop}
                                    type="button"
                                    onClick={() => insertProperty(index, prop)}
                                    className={`text-xs px-3 py-1.5 rounded-md font-mono transition-all ${
                                      isAlreadyReferenced
                                        ? "bg-green-500/20 border border-green-500/30 text-green-700 cursor-default opacity-60"
                                        : "bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 cursor-pointer"
                                    }`}
                                    disabled={isAlreadyReferenced}
                                    title={
                                      isAlreadyReferenced
                                        ? "Already referenced"
                                        : "Click to insert"
                                    }
                                  >
                                    {isAlreadyReferenced ? "✓" : "+"} {prop}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      {/* Show all referenced properties summary */}
                      {schemaProperties.length > 0 &&
                        agent.prompt.includes("/") && (
                          <div className="mt-2 text-xs text-muted-foreground space-y-1 p-2 bg-blue-500/5 rounded border border-blue-500/20">
                            <p className="font-medium">📍 Schema properties used:</p>
                            <div className="flex flex-wrap gap-1">
                              {schemaProperties
                                .filter((prop) =>
                                  agent.prompt.includes(`/${prop}`)
                                )
                                .map((prop) => (
                                  <span
                                    key={prop}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded text-blue-700 font-mono"
                                  >
                                    ✓ {prop}
                                  </span>
                                ))}
                            </div>
                          </div>
                        )}

                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3" />
                          The agent will process results from the previous step
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {agent.prompt.length}/5000 characters
                        </p>
                      </div>
                    </div>

                    {/* Criticality Selector */}
                    <div>
                      <label className="text-xs font-medium block mb-1.5">
                        Task Criticality
                      </label>
                      <div className="flex gap-2">
                        {["low", "medium", "high"].map((level) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() =>
                              updateAgent(index, {
                                criticality: level as TaskCriticality
                              })
                            }
                            className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
                              agent.criticality === level
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted border border-border hover:border-primary"
                            }`}
                          >
                            {level === "high" && "🔴 High"}
                            {level === "medium" && "🟡 Medium"}
                            {level === "low" && "🟢 Low"}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Higher criticality uses more capable (and slower) models
                      </p>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setEditingAgentIndex(null)}
                        className="gap-2"
                      >
                        <Check className="h-4 w-4" />
                        Done
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingAgentIndex(null)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Another Agent Button */}
      {agents.length > 0 && agents.length < 10 && !showTemplates && (
        <Button
          type="button"
          onClick={() => setShowTemplates(true)}
          variant="outline"
          className="w-full gap-2 h-14 border-dashed bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 border-primary/30"
        >
          <Plus className="h-5 w-5" />
          <span className="font-medium">
            Add Another Agent ({agents.length}/10)
          </span>
        </Button>
      )}

      {/* Max Agents Warning */}
      {agents.length >= 10 && (
        <Card className="p-3 bg-amber-500/5 border-amber-500/20">
          <div className="flex gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Maximum of 10 agents reached. Remove an agent to add a new one.
            </p>
          </div>
        </Card>
      )}

      {/* Visual Pipeline Preview */}
      {agents.length > 0 && (
        <Card className="p-6 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
          <div className="flex items-center gap-2 mb-4">
            <Play className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Your Processing Pipeline
            </h3>
          </div>
          <div className="space-y-3">
            {/* Initial Extraction */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-card border-2 border-border flex items-center justify-center flex-shrink-0">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">
                  Initial Extraction
                </div>
                <div className="text-xs text-muted-foreground">
                  Raw data from AI extraction
                </div>
              </div>
            </div>

            {/* Connector */}
            {agents.filter((a) => a.enabled).length > 0 && (
              <div className="flex items-center gap-3">
                <div className="w-10 flex justify-center">
                  <div className="w-0.5 h-6 bg-gradient-to-b from-border to-primary/50" />
                </div>
              </div>
            )}

            {/* Agents */}
            {agents
              .filter((a) => a.enabled)
              .map((agent, index) => {
                const avatar = BOT_AVATARS[index % BOT_AVATARS.length];
                const enabledAgents = agents.filter((a) => a.enabled);
                return (
                  <div key={`${agent.name}-${index}`}>
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg ${avatar.color} flex items-center justify-center text-lg flex-shrink-0 shadow-md`}
                      >
                        {avatar.icon}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">
                          {agent.name}
                          {/* Show criticality tag */}
                          <span className="ml-2 inline-flex items-center text-xs font-normal">
                            {agent.criticality === "high" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/10 text-destructive">
                                🔴 High
                              </span>
                            )}
                            {agent.criticality === "medium" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-500">
                                🟡 Medium
                              </span>
                            )}
                            {agent.criticality === "low" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500">
                                🟢 Low
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {agent.prompt}
                        </div>
                      </div>
                    </div>
                    {index < enabledAgents.length - 1 && (
                      <div className="flex items-center gap-3 my-2">
                        <div className="w-10 flex justify-center">
                          <div className="w-0.5 h-6 bg-gradient-to-b from-primary/50 to-primary/30" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Final Results */}
            {agents.filter((a) => a.enabled).length > 0 && (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 flex justify-center">
                    <div className="w-0.5 h-6 bg-gradient-to-b from-primary/30 to-primary/20" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border-2 border-primary/30 flex items-center justify-center flex-shrink-0">
                    <Check className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">
                      Final Results
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Processed through {agents.filter((a) => a.enabled).length}{" "}
                      agent
                      {agents.filter((a) => a.enabled).length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
