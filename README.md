# Alma CSV user manager
Taking inspiration from the Alma csv user load Cloud App, the Alma CSV user manager offer extended functionality for creating, updating and deleting users based on comma separated files.

Functionality includes:
- Configuration of multiple custom import profiles at the administrator level, using Add, Update and Delete strategies. For Update profiles, a check will be performed for each user if a user already exists with the same patron name.
- Definition of update strategies at the field level, allowing for more finegrained import procedures targeting specific fields. Three update strategies are available:
    - Keep: retain the current value in Alma
    - Replace: replace the entire field in Alma. If the target field is an array, all values will be overwritten by the new data.
    - Enrich (only for multi-item fields): combine current data from Alma and new data from the csv file.
- An overview of profile settings for the selected profile on the import page to facilitate easy verification if:
    - profile mappings match your use case
    - the format of your csv import profile matches the profile mappings
