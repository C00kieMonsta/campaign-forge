import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ClientsDatabaseService } from "@/shared/database/services/clients.database.service";
import { DataLayersDatabaseService } from "@/shared/database/services/data-layers.database.service";
import { ExtractionJobsDatabaseService } from "@/shared/database/services/extraction-jobs.database.service";
import { InvitationsDatabaseService } from "@/shared/database/services/invitations.database.service";
import { OrganizationMembersDatabaseService } from "@/shared/database/services/organization-members.database.service";
import { OrganizationsDatabaseService } from "@/shared/database/services/organizations.database.service";
import { ProjectsDatabaseService } from "@/shared/database/services/projects.database.service";
import { RolesDatabaseService } from "@/shared/database/services/roles.database.service";
import { SupplierMatchesDatabaseService } from "@/shared/database/services/supplier-matches.database.service";
import { SuppliersDatabaseService } from "@/shared/database/services/suppliers.database.service";
import { UsersDatabaseService } from "@/shared/database/services/users.database.service";
import { PrismaModule } from "@/shared/prisma/prisma.module";

@Module({
  providers: [
    ClientsDatabaseService,
    DataLayersDatabaseService,
    ExtractionJobsDatabaseService,
    InvitationsDatabaseService,
    OrganizationMembersDatabaseService,
    OrganizationsDatabaseService,
    ProjectsDatabaseService,
    RolesDatabaseService,
    SupplierMatchesDatabaseService,
    SuppliersDatabaseService,
    UsersDatabaseService
  ],
  exports: [
    ClientsDatabaseService,
    DataLayersDatabaseService,
    ExtractionJobsDatabaseService,
    InvitationsDatabaseService,
    OrganizationMembersDatabaseService,
    OrganizationsDatabaseService,
    ProjectsDatabaseService,
    RolesDatabaseService,
    SupplierMatchesDatabaseService,
    SuppliersDatabaseService,
    UsersDatabaseService
  ],
  imports: [ConfigModule, PrismaModule]
})
export class DatabaseModule {}
