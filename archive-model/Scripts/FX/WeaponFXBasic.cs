using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
public interface WeaponFX
{
    GameObject parentObject { get; }

    void FireAndRenderFx(Transform originPoint, Transform targetPosition, Vector3 zero, ShipController origin, float damage, float damageMultiplier, int batchIndex);
}


public abstract class WeaponFXBasic : ParticleSimulator, WeaponFX
{
    public Timing _timing;

    public bool _fired = false;

    public Transform _target;
    public Transform _origin;
    public Explosion contactExplosion;

    public GameObject parentObject => gameObject;

    public float _damageMultiplier = 1;
    public float _damage = 10;
    public ShipController _shipController;
    public LayerMask _includesLayers;

    public GameObject weaponFx;
    public WeaponIconType weaponType;

    public Vector3 lastPosition;


    public virtual void FireAndRenderFx(Transform originPoint, Transform targetPosition, Vector3 zero, ShipController shipOrigin, float damage, float dmgMultiplier, int batchIndex)
    {
        _fired = true;
        _target = targetPosition;
        _origin = originPoint;
        _damageMultiplier = dmgMultiplier;
        _damage = damage;
        //offsetFactor = UnityEngine.Random.insideUnitCircle * sphereOffsetFactor;

        _shipController = shipOrigin;
        transform.parent = null;
        _timing.Init();

        UpdatePosition();
        Debug.Log("Firing Cannon WEAPON!");
        lastPosition = transform.position;
    }

    protected override void Start()
    {
        //propBlock = new MaterialPropertyBlock();
        //propBlock.GetFloat("_Fade_overall", fade.Evaluate(timing.GetProgressClamped));

        if (_target != null)
        {
            UpdatePosition();
        }

        base.Start();
    }

    

    protected virtual void SpawnExplosion(Vector3 location)
    {
        var exp = Instantiate(contactExplosion, location, Quaternion.identity);

    }

    protected virtual bool HitTargetDetection(RaycastHit hit)
    {
        var shipRb = hit.collider.attachedRigidbody;

        if (hit.collider.gameObject == gameObject)
        {
            return false;
        }
        
        if (shipRb == null)
        {
            Debug.Log("weapon hit collider detected " + hit.collider.transform.name + " But no RB!");
            return true;
        }

        var  ship = shipRb.GetComponent<ShipController>();
        var directionAndMagnitude = Vector3.zero;// direction * animationLen + offsetFactor;
        bool spawnContactExplosion = false;
        if (ship != null)
        {
            if(ship == _shipController)
            {
                Debug.LogError("Self hit detected! Please adjust FIRING ARC!");
                return false;
            }
            //Debug.Log($"weapon firing {Damage} with multiplier {damageMultiplier}");
            PerformDamageProcedure(hit.collider, ref spawnContactExplosion, ship);
        }
        else
        {
            Debug.LogError("Warning! Ship is null, we shouldn't be handling this!");

        }

        if (spawnContactExplosion && hit.collider != null)
        {
            SpawnExplosion(hit.point);
            weaponFx.SetActive(false);
            GameManager.Instance.RemoveSimulator(this);
        }

        Debug.Log($"Cannon hit detected, firing from {_shipController.gameObject.name} to {shipRb.gameObject.name} ");

        return spawnContactExplosion;
    }


    public void PerformDamageProcedure(Collider collider, ref bool spawnContactExplosion, ShipController ship)
    {
        //Debug.Log($"weapon firing {Damage} with multiplier {damageMultiplier}");
        var subsystem = collider.transform.GetComponent<SubsystemColliderProxy>();
        if (subsystem != null && ship != _shipController)
        {
            // absorb some damage
            //Debug.Log($"weapon firing @ subsystem {Damage} with multiplier {damageMultiplier}");
            subsystem.Damage(_damage * _damageMultiplier, new FiredEvent() { firedShip = _shipController });

            if (subsystem.subsystemDamageTarget is ArmorPlating)
            {
                var armor = subsystem.subsystemDamageTarget;
                if (armor.HealthPercent > 0)
                {
                    spawnContactExplosion = true;
                }
            }
        }
        else
        {
            //Debug.Log($"weapon firing @ subsystem {Damage} with multiplier {damageMultiplier}");
            spawnContactExplosion = true;
            // there should be no damage, I don't know where this is coming from lol?
            ship.TakeDamage(_damage * _damageMultiplier, new FiredEvent() { firedShip = _shipController });
        }
    }

    protected abstract void UpdatePosition();
    //{
        //var offset = _target.position - origin.position;
        //var len = offset.magnitude;
        //lineRenderer.SetPositions(new Vector3[] {
        //        origin.position,
        //        origin.position + offset.normalized * len * lineLength.Evaluate(timing.GetProgressClamped),
        //    });
    //}

}
