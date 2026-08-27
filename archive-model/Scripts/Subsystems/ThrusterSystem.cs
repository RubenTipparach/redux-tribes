using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ThrusterSystem : ShipSubsystem
{
    public override float HealthPercent => systemHealth.Percent;
    public override string HealthDisplayText => $"{systemHealth.currentHealth}/{systemHealth.startingHealth}";
    public override string SubsystemName => "Main Thrusters";

    public override Transform targetLocation => targetter;

    public HealthStats systemHealth;

    public Transform targetter;

     [Range(0,100)]
    public int blockDamagePercent = 10;

    public AudioSource engineAudioSource;
    public AudioSource afterBurnAudioSource;

    public override HealthStats SubsystemHealth => systemHealth; 


    public ThrusterEngine[] engines;

    public void UpdateThrusterPower(float time, ShipMoveModes shipMoveModes)
    {
        if(shipMoveModes == ShipMoveModes.MOVE_AND_TURN)
        {
            SetEngineArray(.5f, time);
        }

        if(shipMoveModes == ShipMoveModes.FULL_SPEED)
        {
            SetEngineArray(1f, time);
        }
    }

    private void SetEngineArray(float maxNumber, float time)
    {
        if (time < 1f)
        {
            foreach (var e in engines)
            {
                e.SetThrusterPower(time * maxNumber);
            }

        }
        else if (time > 1.5f && time < 5.5f)
        {
            if (!afterBurnAudioSource.isPlaying && maxNumber > .4f)
            {
                afterBurnAudioSource.Play();
            }
        }
        else if (time > 9f)
        {
            foreach (var e in engines)
            {
                e.SetThrusterPower((1 - (time - 9)) * maxNumber);
            }
        }

    }

    public override void Damage(float amount, FiredEvent firedEvent = null, bool isRaw = false)
    {
        if (systemHealth.IsDead)
        {
            //gameObject.SetActive(false);
            ship.TakeDamage(amount, firedEvent);
            engineAudioSource.Stop();
            foreach(var engine in engines)
            {
                engine.gameObject.SetActive(false); // if we have fixed engines fire them up online again!
            }
        }
        else
        {
            float damageRatio = isRaw ? 1 : blockDamagePercent / 100f;
            systemHealth.TakeDamage(damageRatio * amount);
            ship.TakeDamage(amount * (1 - damageRatio), firedEvent);

            smokeSystem.CheckTriggerSmoke(systemHealth.Percent);
        }
    }

    public override void Heal(float amount)
    {
        systemHealth.Heal(amount);
        smokeSystem.CheckTriggerSmoke(systemHealth.Percent);
    }

    public override void Init()
    {
        smokeSystem.Init();
    }

    
    void Awake(){
        ship = GetComponentInParent<ShipController>();
        systemHealth.Init();
    }

    void Start(){
        Init();
        Debug.Log("pause smoking");
    }


}

[Serializable]
public class SmokeSystem{
    
    [Range(0, 1f)]
    public float damagePercentToSmokeLimit = .25f;

    public SmokeTrails smokeTrails;

    public void Init()
    {
        smokeTrails.StopSmoking();

    }

    public void CheckTriggerSmoke(float healthPercent){
        if (smokeTrails != null)
        {
            if (healthPercent < damagePercentToSmokeLimit)
            {
                smokeTrails.StartSmoking();
                // Debug.Log("starting smoke");
            }
        }
    }
}