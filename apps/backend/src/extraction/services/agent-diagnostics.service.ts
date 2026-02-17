import { Injectable, Logger } from "@nestjs/common";
import {
  AGENT_RESULT_STATUSES,
  AgentErrorSummary,
  AgentExecutionMetadata,
  AgentPipelineDiagnostics
} from "@packages/types";

/**
 * Analyzes agent execution metadata to provide detailed diagnostics
 * and actionable recommendations for improving agent reliability.
 */
@Injectable()
export class AgentDiagnosticsService {
  /**
   * Analyzes agent execution metadata and generates diagnostic report
   */
  analyzePipelineExecution(
    allMetadata: AgentExecutionMetadata[][],
    totalAgents: number
  ): AgentPipelineDiagnostics {
    if (allMetadata.length === 0) {
      return {
        totalResults: 0,
        totalAgents,
        successfulAgents: 0,
        failedAgents: 0,
        overallSuccessRate: 100,
        agentErrors: [],
        criticalIssues: [],
        recommendations: []
      };
    }

    const totalResults = allMetadata.length;

    // Group metadata by agent
    const agentMetadata = new Map<string, AgentExecutionMetadata[]>();
    for (const resultMetadata of allMetadata) {
      for (const meta of resultMetadata) {
        const key = `${meta.agentName}-${meta.agentOrder}`;
        if (!agentMetadata.has(key)) {
          agentMetadata.set(key, []);
        }
        agentMetadata.get(key)!.push(meta);
      }
    }

    // Analyze each agent
    const agentErrors: AgentErrorSummary[] = [];
    let totalSuccessfulAgents = 0;
    let totalFailedAgents = 0;
    const criticalIssues: string[] = [];

    for (const [_, metadataList] of agentMetadata) {
      if (metadataList.length === 0) continue;

      const firstMeta = metadataList[0];
      const successCount = metadataList.filter(
        (m) => m.status === AGENT_RESULT_STATUSES.SUCCESS
      ).length;
      const failureCount = metadataList.filter(
        (m) => m.status === AGENT_RESULT_STATUSES.FAILED
      ).length;
      const timeoutCount = metadataList.filter(
        (m) => m.status === AGENT_RESULT_STATUSES.TIMEOUT
      ).length;
      const successRate = (successCount / metadataList.length) * 100;

      if (successRate === 100) {
        totalSuccessfulAgents++;
      } else {
        totalFailedAgents++;
      }

      // Collect error details
      const errors = metadataList
        .map((m, idx) => ({
          resultIndex: idx,
          error: m.error || "Unknown error",
          status: m.status as "failed" | "timeout"
        }))
        .filter(
          (e) =>
            e.status === AGENT_RESULT_STATUSES.FAILED ||
            e.status === AGENT_RESULT_STATUSES.TIMEOUT
        );

      agentErrors.push({
        agentName: firstMeta.agentName,
        agentOrder: firstMeta.agentOrder,
        totalAttempts: metadataList.length,
        successCount,
        failureCount,
        timeoutCount,
        successRate,
        errors: errors.slice(0, 3) // Top 3 errors
      });

      // Identify critical issues
      if (timeoutCount > 0) {
        criticalIssues.push(
          `Agent "${firstMeta.agentName}" timed out ${timeoutCount} times (consider increasing timeout)`
        );
      }

      if (failureCount > totalResults * 0.2) {
        // More than 20% failures
        criticalIssues.push(
          `Agent "${firstMeta.agentName}" has ${failureCount} failures (${successRate.toFixed(1)}% success rate)`
        );
      }

      // Check for JSON parsing errors
      const jsonErrors = errors.filter((e) =>
        e.error.toLowerCase().includes("json")
      );
      if (jsonErrors.length > 0) {
        criticalIssues.push(
          `Agent "${firstMeta.agentName}" returned invalid JSON ${jsonErrors.length} times - review prompt`
        );
      }
    }

    // Calculate overall success rate
    const totalSuccessful = allMetadata
      .flat()
      .filter((m) => m.status === AGENT_RESULT_STATUSES.SUCCESS).length;
    const overallSuccessRate =
      (totalSuccessful / (totalResults * totalAgents)) * 100;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      agentErrors,
      overallSuccessRate,
      criticalIssues
    );

    return {
      totalResults,
      totalAgents,
      successfulAgents: totalSuccessfulAgents,
      failedAgents: totalFailedAgents,
      overallSuccessRate: Math.min(100, overallSuccessRate),
      agentErrors,
      criticalIssues,
      recommendations
    };
  }

  /**
   * Generates actionable recommendations based on diagnostics
   */
  private generateRecommendations(
    agentErrors: AgentErrorSummary[],
    overallSuccessRate: number,
    criticalIssues: string[]
  ): string[] {
    const recommendations: string[] = [];

    // High-level recommendations
    if (overallSuccessRate < 50) {
      recommendations.push(
        "🚨 Overall agent pipeline success rate is very low. Consider disabling agents or reviewing schemas."
      );
    } else if (overallSuccessRate < 80) {
      recommendations.push(
        "⚠️ Agent pipeline success rate below 80%. Review agent prompts for clarity."
      );
    }

    // Per-agent recommendations
    for (const agent of agentErrors) {
      if (agent.successRate < 50) {
        recommendations.push(
          `Agent "${agent.agentName}": Success rate ${agent.successRate.toFixed(1)}% - likely has unclear prompt. Rewrite with explicit format requirements.`
        );
      }

      if (agent.timeoutCount > 0) {
        recommendations.push(
          `Agent "${agent.agentName}": Timeouts detected. Consider: (1) Simpler prompt, (2) Smaller batch size, (3) Higher timeout`
        );
      }

      // Analyze common errors
      const errorMessages = agent.errors.map((e) => e.error);
      const jsonErrorCount = errorMessages.filter((e) =>
        e.toLowerCase().includes("json")
      ).length;

      if (jsonErrorCount > agent.errors.length * 0.5) {
        recommendations.push(
          `Agent "${agent.agentName}": Invalid JSON errors - add to prompt: "Return ONLY valid JSON. NO markdown code blocks. NO explanations."`
        );
      }

      const arrayErrorCount = errorMessages.filter((e) =>
        e.toLowerCase().includes("array")
      ).length;

      if (arrayErrorCount > 0) {
        recommendations.push(
          `Agent "${agent.agentName}": Not returning arrays - ensure prompt says "Return a JSON array [...]"`
        );
      }
    }

    return recommendations.slice(0, 5); // Top 5 recommendations
  }

  /**
   * Formats diagnostics for logging
   */
  formatForLogging(diagnostics: AgentPipelineDiagnostics): string {
    return JSON.stringify({
      level: "info",
      action: "agentPipelineDiagnostics",
      totalResults: diagnostics.totalResults,
      totalAgents: diagnostics.totalAgents,
      successfulAgents: diagnostics.successfulAgents,
      failedAgents: diagnostics.failedAgents,
      overallSuccessRate: diagnostics.overallSuccessRate.toFixed(1) + "%",
      issueCount: diagnostics.criticalIssues.length,
      recommendationCount: diagnostics.recommendations.length
    });
  }

  /**
   * Formats diagnostics for user display
   */
  formatForDisplay(diagnostics: AgentPipelineDiagnostics): string {
    let message = "";

    // Summary
    message += `✅ Agent Pipeline Summary\n`;
    message += `Total Results: ${diagnostics.totalResults}\n`;
    message += `Success Rate: ${diagnostics.overallSuccessRate.toFixed(1)}%\n`;
    message += `${diagnostics.successfulAgents}/${diagnostics.totalAgents} agents successful\n\n`;

    // Issues
    if (diagnostics.criticalIssues.length > 0) {
      message += `⚠️ Issues:\n`;
      diagnostics.criticalIssues.forEach((issue) => {
        message += `• ${issue}\n`;
      });
      message += "\n";
    }

    // Recommendations
    if (diagnostics.recommendations.length > 0) {
      message += `💡 Recommendations:\n`;
      diagnostics.recommendations.forEach((rec) => {
        message += `• ${rec}\n`;
      });
    }

    return message;
  }
}
