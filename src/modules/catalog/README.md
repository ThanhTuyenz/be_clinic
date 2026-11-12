# Catalog

Owns branch, specialty and service-package catalog reads and administration.

VitaCare is a single clinic chain. `Branch` represents each operating location directly;
there is no parent `Clinic` entity or `Branch.clinicId`. Creating or editing a branch
does not require a clinic record.

- `BranchesController`: existing `/branches` endpoints.
- `SpecialtiesController`: existing public navigation, homepage, specialty and package endpoints.
- `SystemCatalogController`: existing `/admin/catalog` endpoints and permissions.
- `PackagesService` and `SpecialtiesService` remain separate services; consumers import `CatalogModule`.

Doctor scheduling, room occupancy, bookings and appointment operations remain in their existing domains.
Search ranking is provided by `SearchModule`; recommendation ranking remains independent.

Shared interaction collection and booking attribution live in `modules/analytics`.
Recommendation metrics and demand reports live in `admin-dashboard/analytics`.
Integration configuration status and SMTP verification live in `admin-dashboard/integrations`.
