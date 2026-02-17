#!/usr/bin/env bash

set -euo pipefail

# Fast cleanup for stalled RemoraiApp CloudFormation/ECS/ALB resources
# Usage:
#   AWS_PROFILE=production AWS_REGION=eu-north-1 ./scripts/force-delete-remorai.sh
# Optional envs:
#   STACK_PREFIX (default: RemoraiApp)
#   CORE_STACK (default: RemoraiAppCore-production)
#   BACKEND_STACK (default: RemoraiAppBackend-production)
#   FRONTEND_STACK (default: RemoraiAppFrontend-production)

STACK_PREFIX=${STACK_PREFIX:-RemoraiApp}
CORE_STACK=${CORE_STACK:-${STACK_PREFIX}Core-production}
BACKEND_STACK=${BACKEND_STACK:-${STACK_PREFIX}Backend-production}
FRONTEND_STACK=${FRONTEND_STACK:-${STACK_PREFIX}Frontend-production}
AWS_REGION=${AWS_REGION:-${CDK_DEFAULT_REGION:-eu-north-1}}
AWS_PROFILE=${AWS_PROFILE:-production}

log() {
  echo -e "\033[1;34m[INFO]\033[0m $*"
}

warn() {
  echo -e "\033[1;33m[WARN]\033[0m $*" >&2
}

err() {
  echo -e "\033[1;31m[ERROR]\033[0m $*" >&2
}

run() {
  log "$*"
  if ! eval "$*"; then
    warn "Command failed (continuing): $*"
  fi
}

stack_exists() {
  local name=$1
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --stack-name "$name" >/dev/null 2>&1
}

delete_stack_if_exists() {
  local name=$1
  if stack_exists "$name"; then
    log "Deleting stack: $name"
    run "aws cloudformation delete-stack --stack-name '$name' --region '$AWS_REGION' --profile '$AWS_PROFILE'"
  else
    log "Stack not found (skip): $name"
  fi
}

wait_stack_deleted() {
  local name=$1
  if stack_exists "$name"; then
    log "Waiting for deletion to complete: $name"
    run "aws cloudformation wait stack-delete-complete --stack-name '$name' --region '$AWS_REGION' --profile '$AWS_PROFILE'"
  fi
}

get_core_resource() {
  local logical_type=$1
  aws cloudformation describe-stack-resources \
    --stack-name "$CORE_STACK" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query "StackResources[?ResourceType=='$logical_type'].PhysicalResourceId" \
    --output text 2>/dev/null || true
}

scale_down_and_delete_ecs_services() {
  local cluster_arn="$1"
  if [[ -z "$cluster_arn" || "$cluster_arn" == "None" ]]; then
    log "No ECS cluster ARN found; skipping ECS cleanup"
    return 0
  fi

  log "Listing ECS services in cluster: $cluster_arn"
  local services
  services=$(aws ecs list-services \
    --cluster "$cluster_arn" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'serviceArns[]' --output text 2>/dev/null || true)

  if [[ -z "$services" ]]; then
    log "No ECS services found in cluster"
    return 0
  fi

  for svc in $services; do
    log "Scaling service to 0: $svc"
    run "aws ecs update-service --cluster '$cluster_arn' --service '$svc' --desired-count 0 --region '$AWS_REGION' --profile '$AWS_PROFILE'"
  done

  # Wait briefly for tasks to stop (avoid long waits)
  sleep 5 || true

  for svc in $services; do
    log "Force deleting service: $svc"
    run "aws ecs delete-service --cluster '$cluster_arn' --service '$svc' --force --region '$AWS_REGION' --profile '$AWS_PROFILE'"
  done
}

delete_alb_and_dependents() {
  local lb_arn="$1"
  if [[ -z "$lb_arn" || "$lb_arn" == "None" ]]; then
    log "No ALB ARN found; skipping ALB cleanup"
    return 0
  fi

  log "Deleting ALB listeners for: $lb_arn"
  local listeners
  listeners=$(aws elbv2 describe-listeners \
    --load-balancer-arn "$lb_arn" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'Listeners[].ListenerArn' --output text 2>/dev/null || true)

  for l in $listeners; do
    run "aws elbv2 delete-listener --listener-arn '$l' --region '$AWS_REGION' --profile '$AWS_PROFILE'"
  done

  log "Deleting target groups for ALB"
  local tgs
  tgs=$(aws elbv2 describe-target-groups \
    --load-balancer-arn "$lb_arn" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'TargetGroups[].TargetGroupArn' --output text 2>/dev/null || true)

  for tg in $tgs; do
    run "aws elbv2 delete-target-group --target-group-arn '$tg' --region '$AWS_REGION' --profile '$AWS_PROFILE'"
  done

  log "Deleting ALB: $lb_arn"
  run "aws elbv2 delete-load-balancer --load-balancer-arn '$lb_arn' --region '$AWS_REGION' --profile '$AWS_PROFILE'"
}

main() {
  log "Region: $AWS_REGION  Profile: $AWS_PROFILE  Prefix: $STACK_PREFIX"

  # 1) Delete dependent stacks first if present
  delete_stack_if_exists "$FRONTEND_STACK"
  delete_stack_if_exists "$BACKEND_STACK"

  # 2) Proactively clean ECS/ALB created by Core to avoid export reference issues
  if stack_exists "$CORE_STACK"; then
    local cluster_arn
    cluster_arn=$(get_core_resource 'AWS::ECS::Cluster')
    scale_down_and_delete_ecs_services "$cluster_arn"

    local lb_arn
    lb_arn=$(get_core_resource 'AWS::ElasticLoadBalancingV2::LoadBalancer')
    delete_alb_and_dependents "$lb_arn"
  fi

  # 3) Delete stacks (reverse order) and wait
  wait_stack_deleted "$FRONTEND_STACK"
  wait_stack_deleted "$BACKEND_STACK"

  delete_stack_if_exists "$CORE_STACK"
  wait_stack_deleted "$CORE_STACK"

  log "Cleanup completed."
}

main "$@"


