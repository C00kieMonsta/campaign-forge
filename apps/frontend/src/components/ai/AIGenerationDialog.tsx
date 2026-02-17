import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea
} from "@packages/ui";
import { Copy, History, Loader2, Sparkles } from "lucide-react";
import { type ZodType, type ZodTypeDef } from "zod";
import { generateFromLLM } from "@/lib/api";

interface _PromptHistoryItem {
  id: string;
  prompt: string;
  timestamp: number;
}

interface AIGenerationDialogProps<T> {
  buttonText: string;
  title: string;
  description: string;
  disabled?: boolean;
  placeholder?: string;
  buttonIcon?: React.ReactNode;
  buttonVariant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  buttonClassName?: string;
  format: "popover" | "dialog";
  popoverWidth?: string;
  outputSchema?: ZodType<T, ZodTypeDef, T>;
  systemPrompt: string;
  generatePrompt: (input: string) => string;
  parseResponse?: (response: string) => T;
  onGenerate: (results: T) => void;
}

// Utility functions for managing prompt history in localStorage
const PROMPT_HISTORY_KEY_PREFIX = "ai_prompt_history";
const MAX_HISTORY_ITEMS = 10;

const _getPromptHistoryKey = (title: string): string => {
  // Create a safe key by removing special characters and spaces
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${PROMPT_HISTORY_KEY_PREFIX}_${safeTitle}`;
};

const _getPromptHistory = (title: string): _PromptHistoryItem[] => {
  try {
    const key = _getPromptHistoryKey(title);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const _savePromptToHistory = (prompt: string, title: string) => {
  if (!prompt.trim()) return;
  const history = _getPromptHistory(title);
  const newItem: _PromptHistoryItem = {
    id: Date.now().toString(),
    prompt: prompt.trim(),
    timestamp: Date.now()
  };
  const updatedHistory = [newItem, ...history];
  const limitedHistory = updatedHistory.slice(0, MAX_HISTORY_ITEMS);
  const key = _getPromptHistoryKey(title);
  localStorage.setItem(key, JSON.stringify(limitedHistory));
};

/**
 * A reusable AI generation dialog component that provides a standard interface
 * for generating content using AI across the application.
 */
export function AIGenerationDialog<T>({
  buttonText,
  title,
  description,
  disabled = false,
  placeholder = "Type your input here...",
  buttonIcon = <Sparkles className="h-4 w-4" />,
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonClassName = "border-dashed border-2 hover:bg-muted/50 text-primary font-normal",
  popoverWidth = "w-[500px]",
  format = "popover",
  systemPrompt,
  outputSchema,
  generatePrompt,
  parseResponse,
  onGenerate
}: AIGenerationDialogProps<T>) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<_PromptHistoryItem[]>([]);

  // Load prompt history on component mount
  useEffect(() => {
    setPromptHistory(_getPromptHistory(title));
  }, [title]);

  const handleGenerate = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    setError(null);

    // Save prompt to history before generating
    _savePromptToHistory(inputText, title);
    setPromptHistory(_getPromptHistory(title)); // Refresh history state

    try {
      // Prepare the prompt with the input text
      const prompt = generatePrompt(inputText);

      const response = await generateFromLLM({
        system: systemPrompt,
        prompt
      });

      const data = await response.json();

      // Process the response
      if (data.result) {
        try {
          let responseText = data.result;
          // Try to extract JSON if it's wrapped in other text
          const jsonMatch =
            responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
            responseText.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            responseText = jsonMatch[0];
          }

          // Clean the response in case it has code block markers
          responseText = responseText
            .replace(/```(json)?\s*|\s*```/g, "")
            .trim();

          // Parse JSON from the text
          let parsedJson: any;
          try {
            parsedJson = JSON.parse(responseText);
          } catch {
            setError("The AI generated invalid JSON. Please try again.");
            return;
          }

          // Apply custom parsing if provided, otherwise use direct JSON
          let parsedItems: T;

          // First, use parseResponse if available (preferred approach for type-specific handling)
          if (parseResponse) {
            try {
              parsedItems = parseResponse(responseText);
            } catch {
              setError("Error processing the response. Please try again.");
              return;
            }
          } else {
            // If no custom parser, use raw JSON and validate with schema if available
            if (outputSchema) {
              try {
                // Validate with Zod schema if provided
                parsedItems = outputSchema.parse(parsedJson);
              } catch (zodError) {
                console.error("Schema validation error:", zodError);

                // Basic fallback for structured data
                if (
                  parsedJson &&
                  typeof parsedJson === "object" &&
                  Object.keys(parsedJson).length > 0
                ) {
                  console.log(
                    "Using fallback (raw JSON) for AI-generated data"
                  );
                  parsedItems = parsedJson as T;
                } else {
                  setError(
                    "The generated content doesn't match the expected format. Please try again with a different prompt."
                  );
                  return;
                }
              }
            } else {
              // No schema, no parser, use raw JSON
              parsedItems = parsedJson;
            }
          }

          // Pass the generated items to the parent component
          onGenerate(parsedItems as T);

          // Close the popover
          setOpen(false);
          setInputText("");
        } catch (parseError) {
          console.error("Error parsing AI response:", parseError);
          setError("Failed to parse the AI response. Please try again.");
        }
      } else if (data.error) {
        console.error("API error:", data.error);
        setError(`Error: ${data.error}`);
      } else {
        setError("No results returned from AI. Please try again.");
      }
    } catch (err) {
      console.error("Error generating content:", err);
      setError("An error occurred while generating content. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseHistoryPrompt = (historyPrompt: string) => {
    setInputText(historyPrompt);
    setHistoryOpen(false);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    } else if (diffInHours < 24 * 7) {
      return date.toLocaleDateString([], {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  const renderAIArea = () => {
    return (
      <div className="space-y-4">
        {format === "popover" && (
          <span className="flex items-center justify-between">
            <span className="flex items-center">
              <Sparkles className="h-4 w-4 mr-2" />
              <h4 className="font-medium">{title}</h4>
            </span>
            {promptHistory.length > 0 && (
              <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    title="Show prompt history"
                  >
                    <History className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-2" side="left">
                  <div className="space-y-1">
                    <h5 className="font-medium text-sm mb-2">Recent Prompts</h5>
                    <div className="max-h-[300px] overflow-y-auto space-y-1">
                      {promptHistory.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                          No recent prompts.
                        </p>
                      ) : (
                        promptHistory.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer group"
                            style={{ minHeight: 32 }}
                            onClick={() => handleUseHistoryPrompt(item.prompt)}
                          >
                            <div className="flex-1 min-w-0" title={item.prompt}>
                              <p
                                className="text-xs text-foreground truncate"
                                style={{
                                  maxWidth: "220px",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis"
                                }}
                              >
                                {item.prompt}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {formatDate(item.timestamp)}
                              </p>
                            </div>
                            <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </span>
        )}
        {format === "dialog" && promptHistory.length > 0 && (
          <div className="flex justify-end">
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  title="Show prompt history"
                >
                  <History className="h-4 w-4" />
                  Recent Prompts
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-2" side="left">
                <div className="space-y-1">
                  <h5 className="font-medium text-sm mb-2">Recent Prompts</h5>
                  <div className="max-h-[300px] overflow-y-auto space-y-1">
                    {promptHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                        No recent prompts.
                      </p>
                    ) : (
                      promptHistory.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer group"
                          style={{ minHeight: 32 }}
                          onClick={() => handleUseHistoryPrompt(item.prompt)}
                        >
                          <div className="flex-1 min-w-0" title={item.prompt}>
                            <p
                              className="text-xs text-foreground truncate"
                              style={{
                                maxWidth: "220px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis"
                              }}
                            >
                              {item.prompt}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {formatDate(item.timestamp)}
                            </p>
                          </div>
                          <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
        {format === "popover" && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        <Textarea
          placeholder={placeholder}
          value={inputText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setInputText(e.target.value)
          }
          className="min-h-[150px] resize-none max-h-[70vh]"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          {format === "dialog" && (
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
          )}
          <Button
            onClick={handleGenerate}
            disabled={isLoading || !inputText.trim()}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      {format === "popover" ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={buttonVariant}
              size={buttonSize}
              className={buttonClassName}
              disabled={disabled}
            >
              {buttonIcon}
              {buttonText}
            </Button>
          </PopoverTrigger>
          <PopoverContent className={`${popoverWidth} mr-20`}>
            {renderAIArea()}
          </PopoverContent>
        </Popover>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant={buttonVariant}
              size={buttonSize}
              className={buttonClassName}
              disabled={disabled}
            >
              {buttonIcon}
              {buttonText}
            </Button>
          </DialogTrigger>
          <DialogContent className="flex flex-col !max-w-[90vw] overflow-y-auto">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2">
              {renderAIArea()}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
