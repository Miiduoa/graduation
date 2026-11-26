-- Product-QA class-layer login mints a platform credential that is not Google/Apple.
-- Issuer is https://nuni.invalid/product-qa-platform; subject is the QA username.

ALTER TABLE platform_account_credentials
  DROP CONSTRAINT platform_account_credentials_method_check;

ALTER TABLE platform_account_credentials
  ADD CONSTRAINT platform_account_credentials_method_check
    CHECK (method IN ('google', 'apple', 'qa'));
