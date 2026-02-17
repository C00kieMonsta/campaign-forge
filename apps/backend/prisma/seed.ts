import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] main - Seeding database...");

  // Create system roles (simplified - no permissions table)
  console.log("[seed] main - Creating system roles...");

  let adminRole = await prisma.role.findFirst({
    where: {
      slug: "admin",
      organizationId: null,
      isSystem: true
    }
  });

  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: {
        name: "Administrator",
        slug: "admin",
        description: "Full system access with all capabilities",
        isSystem: true,
        organizationId: null
      }
    });
  }

  let memberRole = await prisma.role.findFirst({
    where: {
      slug: "member",
      organizationId: null,
      isSystem: true
    }
  });

  if (!memberRole) {
    memberRole = await prisma.role.create({
      data: {
        name: "Member",
        slug: "member",
        description: "Basic member access with limited capabilities",
        isSystem: true,
        organizationId: null
      }
    });
  }

  // Create default organization
  console.log("Creating default organization...");
  let defaultOrg = await prisma.organization.findFirst({
    where: { slug: "remorai-labs" }
  });

  if (!defaultOrg) {
    defaultOrg = await prisma.organization.create({
      data: {
        name: "Remorai Labs",
        slug: "remorai-labs",
        description:
          "Remorai Labs is a company that provides AI-powered solutions for businesses.",
        meta: {}
      }
    });
  }

  // Create default user
  console.log("Creating default user...");
  const defaultUserId = "00000000-0000-4000-8000-000000000001"; // Fixed UUID for seed user
  const defaultUserEmail = "admin@remorai.solutions";

  let defaultUser = await prisma.user.findFirst({
    where: { id: defaultUserId }
  });

  if (!defaultUser) {
    try {
      defaultUser = await prisma.user.create({
        data: {
          id: defaultUserId,
          email: defaultUserEmail,
          firstName: "Admin",
          lastName: "User",
          timezone: "UTC",
          meta: {}
        }
      });
    } catch (error: any) {
      // If user already exists with different ID but same email, find by email
      if (error.code === "P2002" && error.meta?.target?.includes("email")) {
        defaultUser = await prisma.user.findUnique({
          where: { email: defaultUserEmail }
        });
        if (!defaultUser) {
          throw error; // Re-throw if we still can't find the user
        }
      } else {
        throw error;
      }
    }
  }

  // Create organization membership for the default user with Admin role
  console.log("Creating organization membership...");
  const existingMembership = await prisma.organizationMember.findFirst({
    where: {
      organizationId: defaultOrg.id,
      userId: defaultUser.id
    }
  });

  if (!existingMembership) {
    await prisma.organizationMember.create({
      data: {
        organizationId: defaultOrg.id,
        userId: defaultUser.id,
        roleId: adminRole.id,
        status: "active"
      }
    });
  }

  // Create default client
  console.log("Creating default client...");
  let defaultClient = await prisma.client.findFirst({
    where: {
      organizationId: defaultOrg.id,
      name: "Default Client"
    }
  });

  if (!defaultClient) {
    defaultClient = await prisma.client.create({
      data: {
        organizationId: defaultOrg.id,
        name: "Default Client",
        description: "Default client for initial setup and testing",
        contactName: "John Doe",
        contactEmail: "contact@defaultclient.com",
        contactPhone: "+1-555-0123",
        address: {
          street: "123 Main St",
          city: "Anytown",
          state: "CA",
          zipCode: "12345",
          country: "USA"
        },
        meta: {}
      }
    });
  }

  // Create default extraction schema
  console.log("Creating default extraction schema...");
  const defaultSchemaId = "00000000-0000-4000-8000-000000000050";

  let defaultSchema = await prisma.extractionSchema.findFirst({
    where: { id: defaultSchemaId }
  });

  if (!defaultSchema) {
    await prisma.extractionSchema.create({
      data: {
        id: defaultSchemaId,
        organizationId: defaultOrg.id,
        name: "default-material-extraction",
        version: 1,
        definition: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          title: "Default Material Extraction Schema",
          description:
            "Default schema for extracting material information from construction documents",
          properties: {
            itemCode: {
              type: "string",
              title: "Item Code",
              description: "Unique identifier for the item"
            },
            itemName: {
              type: "string",
              title: "Item Name",
              description: "Name or description of the item"
            },
            quantity: {
              type: "number",
              title: "Quantity",
              description: "Quantity of the item",
              minimum: 0
            },
            unit: {
              type: "string",
              title: "Unit",
              description: "Unit for the quantity"
            }
          },
          required: ["itemName"]
        },
        compiledJsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          title: "Default Material Extraction Schema",
          description:
            "Default schema for extracting material information from construction documents",
          properties: {
            itemCode: {
              type: "string",
              title: "Item Code",
              description: "Unique identifier for the item"
            },
            itemName: {
              type: "string",
              title: "Item Name",
              description: "Name or description of the item"
            },
            quantity: {
              type: "number",
              title: "Quantity",
              description: "Quantity of the item",
              minimum: 0
            },
            unit: {
              type: "string",
              title: "Unit",
              description: "Unit for the quantity"
            }
          },
          required: ["itemName"]
        }
      }
    });
  }

  console.log("[seed] main - Database seeded successfully!");
  console.log(`📋 Summary:`);
  console.log(`   • Organization: ${defaultOrg.name} (${defaultOrg.slug})`);
  console.log(`   • User: ${defaultUser.email} (Admin role)`);
  console.log(`   • Client: ${defaultClient.name}`);
  console.log(
    `   • Roles: Admin, Member (system roles - no permissions table)`
  );

  // Enable realtime for all tables
  await enableRealtimeForAllTables();
}

async function enableRealtimeForAllTables() {
  console.log("🔄 Configuring Supabase Realtime for all tables...");

  try {
    // Execute the post-migration script to enable realtime for all tables
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE
          table_record RECORD;
          tables_added INTEGER := 0;
          tables_skipped INTEGER := 0;
      BEGIN
          -- Loop through all public tables
          FOR table_record IN 
              SELECT tablename 
              FROM pg_tables 
              WHERE schemaname = 'public' 
              ORDER BY tablename
          LOOP
              -- Check if table is already in the realtime publication
              IF NOT EXISTS (
                  SELECT 1 
                  FROM pg_publication_tables 
                  WHERE pubname = 'supabase_realtime' 
                  AND tablename = table_record.tablename
              ) THEN
                  -- Add table to realtime publication
                  EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_record.tablename);
                  tables_added := tables_added + 1;
              ELSE
                  tables_skipped := tables_skipped + 1;
              END IF;
          END LOOP;
          
      END
      $$;
    `);

    // Get count of tables in realtime publication
    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime'
    `;

    const tableCount = Number(result[0].count);
    console.log(`✅ Realtime enabled for ${tableCount} tables`);
  } catch (error) {
    console.warn(
      "⚠️  Warning: Could not configure realtime (this is normal in non-Supabase environments)"
    );
    console.warn(
      "   Error:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
