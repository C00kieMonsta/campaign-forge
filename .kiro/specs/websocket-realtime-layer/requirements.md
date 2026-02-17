# Requirements Document

## Introduction

This document specifies requirements for implementing a lightweight WebSocket-based real-time layer that enables the UI to receive live updates from the database without polling or page refreshes. The system will use Postgres NOTIFY/LISTEN for database change detection, NestJS WebSocket gateway for event broadcasting, and TanStack Query cache patching on the Next.js frontend for seamless real-time updates.

## Glossary

- **Backend_System**: The NestJS application that handles API requests and WebSocket connections
- **Frontend_System**: The Next.js application that displays data and receives real-time updates
- **Database_System**: The Supabase Postgres database that stores application data
- **PgListener_Service**: The NestJS service that connects to Postgres and listens for NOTIFY events
- **Realtime_Gateway**: The NestJS WebSocket gateway that broadcasts database changes to connected clients
- **WS_Client**: The WebSocket client connection in the browser
- **Query_Cache**: The TanStack Query cache that stores fetched data on the frontend
- **Notification_Payload**: The JSON data sent via Postgres NOTIFY containing change information
- **Channel**: A named topic for database notifications (typically matches table name)

## Requirements

### Requirement 1

**User Story:** As a user viewing extraction jobs, I want to see status updates automatically without refreshing the page, so that I can monitor progress in real-time

#### Acceptance Criteria

1. WHEN an extraction job status changes in the Database_System, THE Backend_System SHALL broadcast the change to subscribed clients within 500 milliseconds
2. WHEN the Frontend_System receives a job status update, THE Frontend_System SHALL update the displayed status without requiring a page refresh
3. THE Frontend_System SHALL maintain the current scroll position and user interaction state when updates are applied
4. WHEN multiple extraction jobs update simultaneously, THE Frontend_System SHALL apply all updates to the Query_Cache atomically
5. IF the WS_Client connection is lost, THEN THE Frontend_System SHALL attempt reconnection with exponential backoff up to 30 seconds

### Requirement 2

**User Story:** As a developer, I want database triggers to automatically notify the system of changes, so that I don't need to manually emit events in application code

#### Acceptance Criteria

1. WHEN a row is inserted into a monitored table, THE Database_System SHALL send a NOTIFY event with operation type INSERT and the new row data
2. WHEN a row is updated in a monitored table, THE Database_System SHALL send a NOTIFY event with operation type UPDATE and the updated row data
3. WHEN a row is deleted from a monitored table, THE Database_System SHALL send a NOTIFY event with operation type DELETE and the deleted row identifier
4. THE Notification_Payload SHALL include the table name, operation type, and relevant row data in JSON format
5. THE Database_System SHALL execute the notification trigger after the transaction commits successfully

### Requirement 3

**User Story:** As a system administrator, I want the WebSocket layer to handle multiple table subscriptions, so that different parts of the UI can receive relevant updates

#### Acceptance Criteria

1. THE PgListener_Service SHALL establish a single persistent connection to the Database_System using the direct Postgres connection string
2. THE PgListener_Service SHALL listen to all channels specified in the PG_CHANNELS environment variable
3. WHEN a notification is received on any channel, THE PgListener_Service SHALL forward it to the Realtime_Gateway
4. THE Realtime_Gateway SHALL maintain a mapping of connected clients to their subscribed channels
5. THE Realtime_Gateway SHALL only send notifications to clients subscribed to the relevant channel

### Requirement 4

**User Story:** As a frontend developer, I want a simple hook to enable real-time updates for any query, so that I can add live functionality without complex code

#### Acceptance Criteria

1. THE Frontend_System SHALL provide a reusable hook that accepts a channel name and query key
2. WHEN the hook is mounted, THE WS_Client SHALL send a subscribe message for the specified channel
3. WHEN the hook is unmounted, THE WS_Client SHALL send an unsubscribe message for the specified channel
4. WHEN a notification is received, THE Frontend_System SHALL update the Query_Cache using the appropriate operation (insert, update, or delete)
5. THE Frontend_System SHALL handle duplicate notifications idempotently without creating duplicate entries

### Requirement 5

**User Story:** As a user, I want the system to gracefully handle connection issues, so that I don't lose functionality when network problems occur

#### Acceptance Criteria

1. IF the PgListener_Service connection to the Database_System fails, THEN THE PgListener_Service SHALL attempt to reconnect after 1 second
2. IF the WS_Client connection closes unexpectedly, THEN THE Frontend_System SHALL attempt to reconnect with exponential backoff
3. WHEN the WS_Client reconnects, THE Frontend_System SHALL resubscribe to all previously subscribed channels
4. WHILE the WS_Client is disconnected, THE Frontend_System SHALL continue to function using cached data and manual refetch capabilities
5. THE Backend_System SHALL clean up client subscriptions when a WebSocket connection closes

### Requirement 6

**User Story:** As a developer, I want to configure which tables emit real-time events, so that I can control system overhead and only broadcast relevant changes

#### Acceptance Criteria

1. THE Backend_System SHALL read the list of monitored channels from the PG_CHANNELS environment variable
2. THE Database_System SHALL only have notification triggers on tables that require real-time updates
3. THE Notification_Payload SHALL be minimal, containing only essential data to identify and update the changed record
4. WHERE a table contains sensitive data, THE Database_System SHALL exclude sensitive fields from the Notification_Payload
5. THE Backend_System SHALL validate that channel names match expected table names before establishing listeners

### Requirement 7

**User Story:** As a user viewing projects, I want to see new projects appear automatically when they are created by other users, so that I have an up-to-date view of all projects

#### Acceptance Criteria

1. WHEN a new project is created in the Database_System, THE Frontend_System SHALL add it to the projects list without requiring a manual refresh
2. WHEN a project is updated by another user, THE Frontend_System SHALL update the displayed project data within 500 milliseconds
3. WHEN a project is deleted, THE Frontend_System SHALL remove it from the displayed list automatically
4. THE Frontend_System SHALL preserve the current sort order when applying real-time updates
5. THE Frontend_System SHALL animate new items to provide visual feedback of the update

### Requirement 8

**User Story:** As a developer, I want the WebSocket implementation to integrate with existing REST APIs, so that I don't need to rewrite data fetching logic

#### Acceptance Criteria

1. THE Frontend_System SHALL continue to use existing REST API endpoints for initial data fetching
2. THE Frontend_System SHALL use TanStack Query for data fetching and caching as currently implemented
3. THE WebSocket layer SHALL only patch the Query_Cache with incremental updates, not replace the entire data fetching mechanism
4. THE Backend_System SHALL continue to use Prisma for all database read and write operations
5. THE Realtime_Gateway SHALL operate independently from existing REST controllers and services
