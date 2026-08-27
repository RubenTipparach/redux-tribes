using System;
using UnityEngine;

// Adapted for floats.
[Serializable]
public class HealthStats
{

    public float startingHealth = 100;
    public float overideCurrentHealth = -1;
    public float currentHealth = 0;

    public void Init()
    {
        if (overideCurrentHealth != -1)
        {
            currentHealth = overideCurrentHealth;
        }
        else
        {
            currentHealth = startingHealth;
        }
    }

    public float Health
    {
        get { return currentHealth; }
    }

    public float Percent
    {
        get
        {
            return currentHealth / startingHealth;
        }
    }

    public void TakeDamage(float damage)
    {
        currentHealth = Mathf.Clamp(currentHealth - damage, 0, startingHealth);
    }

    public float TakeDamageFromRemaining(float damage)
    {
        float remainingDamage = damage - currentHealth;

        if(damage > currentHealth)
        {
            currentHealth = Mathf.Clamp(currentHealth - damage, 0, startingHealth);
            return remainingDamage;
        }
        else{

            currentHealth = Mathf.Clamp(currentHealth - damage, 0, startingHealth);
            return 0;
        }
    }

    public void Heal(float healAmount)
    {
        currentHealth = Mathf.Clamp(currentHealth + healAmount, 0, startingHealth);
    }

    public bool IsFullHealth
    {
        get
        {
            if (currentHealth > startingHealth) currentHealth = startingHealth;
            return currentHealth == startingHealth;
        }
    }

    public float DamagedValue {
        get {
            return startingHealth - currentHealth;
        }
    }

    public void Kill(){
        currentHealth = 0;
    }

    public bool IsDead { get => currentHealth <= 0; }

    public Health ToHealthSave(bool initial = false) {
        return new Health
        {
            value = initial ? this.startingHealth : this.currentHealth,
            initial = this.startingHealth
        };
    }
}


