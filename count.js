const sql = `
    INSERT INTO leads (
      id, linkedin_url, email, first_name, last_name, headline, company, role,
      location, about, experience_json, education_json, skills_json,
      recent_posts_json, mutual_connections_json, profile_image_url,
      connection_degree, is_sales_navigator, status, scraped_at,
      raw_data_json, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(linkedin_url) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      headline = excluded.headline,
      company = excluded.company,
      role = excluded.role,
      location = excluded.location,
      about = excluded.about,
      experience_json = excluded.experience_json,
      education_json = excluded.education_json,
      skills_json = excluded.skills_json,
      recent_posts_json = excluded.recent_posts_json,
      mutual_connections_json = excluded.mutual_connections_json,
      profile_image_url = excluded.profile_image_url,
      connection_degree = excluded.connection_degree,
      is_sales_navigator = excluded.is_sales_navigator,
      email = CASE WHEN excluded.email != '' THEN excluded.email ELSE leads.email END,
      status = CASE WHEN leads.status = 'new' THEN 'profile_scraped' ELSE leads.status END,
      scraped_at = excluded.scraped_at,
      raw_data_json = excluded.raw_data_json,
      updated_at = ?
`;
const placeholders = (sql.match(/\?/g) || []).length;
console.log(`Number of question marks: ${placeholders}`);
