using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ArmorPlating : ShipSubsystem
{

    public HealthStats armorHealth;


    [Range(0,100)]
    public int blockDamagePercent = 100;

    public override float HealthPercent => armorHealth.Percent;
    public override string HealthDisplayText => $"{armorHealth.currentHealth}/{armorHealth.startingHealth}";

    public string ArmorDesignation = "default";
    public override string SubsystemName => "Armnor " + ArmorDesignation;

    public override Transform targetLocation => targetPoint;
    public override HealthStats SubsystemHealth => armorHealth; 

    public Transform targetPoint;

    public override void Damage(float amount, FiredEvent firedEvent = null, bool isRaw = false)
    {
        float damageRatio = isRaw ? 1 :  blockDamagePercent / 100f;
        armorHealth.TakeDamage(damageRatio * amount);
        ship.TakeDamage(amount * (1 - damageRatio), firedEvent);
        
        smokeSystem.CheckTriggerSmoke(armorHealth.Percent);

        if(armorHealth.IsDead){
            gameObject.SetActive(false);
        }
    }

    //cant heal armor.
    public override void Heal(float amount)
    {
    }

    public override void Init()
    {
    }

    void Awake(){
        ship = GetComponentInParent<ShipController>();
        armorHealth.Init();
    }
}
